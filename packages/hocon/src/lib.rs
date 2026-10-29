#![doc = include_str!("../README.md")]
#![forbid(unsafe_code)]

mod edit;
mod load;

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde_json::Value;
use thiserror::Error;

/// Errors retain the operation, entry-point path, and underlying cause.
#[derive(Debug, Error)]
pub enum Error {
    #[error("cannot {operation} '{}': {source}", path.display())]
    Io {
        operation: &'static str,
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("cannot parse or resolve '{}': {source}", path.display())]
    Parse {
        path: PathBuf,
        #[source]
        source: hocon_rs::Error,
    },
    #[error("invalid dot-separated configuration path '{path}' (segments must be nonempty)")]
    InvalidPath { path: String },
    #[error("configuration file '{}' changed; open it again before editing", path.display())]
    Conflict { path: PathBuf },
    #[error("cannot safely edit configuration: {message}")]
    Edit { message: String },
    #[error("cannot encode JSON: {0}")]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

/// A HOCON configuration file with path-based access, editing, and resolution.
///
/// Reads use the values loaded on open. Successful edits save immediately and
/// update those values.
#[derive(Debug)]
pub struct Config {
    path: PathBuf,
    source: String,
    resolved: Value,
}

impl Config {
    /// Load a HOCON entry point, resolving includes relative to each source file.
    /// Creates an empty file and missing parent directories when needed.
    /// Existing files are preserved and symbolic links are followed.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        let path = match fs::canonicalize(path) {
            Ok(path) => path,
            Err(source) if source.kind() == io::ErrorKind::NotFound => {
                let absolute =
                    std::path::absolute(path).map_err(|source| io_error("locate", path, source))?;
                let parent = absolute.parent().expect("absolute paths have a parent");
                fs::create_dir_all(parent)
                    .map_err(|source| io_error("create parent directories for", path, source))?;
                match fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&absolute)
                {
                    Ok(file) => {
                        file.sync_all()
                            .map_err(|source| io_error("sync new file", path, source))?;
                        #[cfg(unix)]
                        fs::File::open(parent)
                            .and_then(|directory| directory.sync_all())
                            .map_err(|source| {
                                io_error("sync directory after creating", path, source)
                            })?;
                    }
                    // Another opener may have created the file. Load its
                    // contents without truncating or replacing it.
                    Err(source) if source.kind() == io::ErrorKind::AlreadyExists => {}
                    Err(source) => return Err(io_error("create", path, source)),
                }
                fs::canonicalize(&absolute).map_err(|source| io_error("locate", path, source))?
            }
            Err(source) => return Err(io_error("locate", path, source)),
        };
        let (source, resolved) = read_snapshot(&path)?;
        Ok(Self {
            path,
            source,
            resolved,
        })
    }

    /// Retrieve an effective value, returning JSON null when the key is absent.
    /// Missing values and explicit JSON null both return `Ok(&Value::Null)`.
    /// Paths address object keys, with dots separating nonempty segments.
    pub fn get(&self, path: &str) -> Result<&Value> {
        validate_path(path)?;
        Ok(path
            .split('.')
            .try_fold(&self.resolved, |value, key| value.as_object()?.get(key))
            .unwrap_or(&Value::Null))
    }

    /// Set a value in the opened file, save it, and refresh resolved values.
    /// Creates a missing file and its parent directories. If the opened file was
    /// deleted, the new file contains only this setting.
    /// Objects follow HOCON's merge semantics when combined with included values.
    /// Ambiguous source edits return [`Error::Edit`] without saving.
    pub fn set(&mut self, path: &str, value: Value) -> Result<()> {
        self.modify(path, Some(&value))
    }

    /// Remove a value's definitions from the opened file, then resolve again.
    /// Included values at that path can become visible after removal.
    /// A path with no definition in the opened file is a no-op.
    /// A missing file is left absent.
    pub fn unset(&mut self, path: &str) -> Result<()> {
        self.modify(path, None)
    }

    /// Borrow the full effective configuration as a JSON-compatible value.
    pub fn resolved(&self) -> Result<&Value> {
        Ok(&self.resolved)
    }

    /// Encode the effective configuration as pretty JSON text, without saving it.
    pub fn to_json(&self) -> Result<String> {
        Ok(serde_json::to_string_pretty(&self.resolved)?)
    }

    fn modify(&mut self, path: &str, value: Option<&Value>) -> Result<()> {
        let segments = segments(path)?;
        let exists = self.ensure_current()?;
        let source = if exists { &self.source } else { "" };
        let candidate = edit::apply(source, &segments, value)?;
        if candidate == source {
            return Ok(());
        }

        // A same-directory temporary .conf keeps relative includes working.
        // It contains the edited source of the opened file.
        let parent = self.path.parent().expect("canonical paths have a parent");
        if !exists {
            fs::create_dir_all(parent)
                .map_err(|source| io_error("create parent directories for", &self.path, source))?;
        }
        let mut staged = tempfile::Builder::new()
            .prefix(".hocon-")
            .suffix(".conf")
            .tempfile_in(parent)
            .map_err(|source| io_error("create temporary file beside", &self.path, source))?;
        staged
            .write_all(candidate.as_bytes())
            .and_then(|()| staged.flush())
            .map_err(|source| io_error("write temporary file for", &self.path, source))?;
        let resolved = resolve(staged.path(), &self.path)?;
        if let Some(expected) = value
            && !lookup(&resolved, &segments).is_some_and(|actual| matches_value(actual, expected))
        {
            return Err(Error::Edit {
                message: format!("'{path}' did not resolve to the requested value"),
            });
        }

        // Catch stale snapshots before replacing the file; this is optimistic
        // conflict detection, not a cross-process lock.
        if self.ensure_current()? != exists {
            return Err(Error::Conflict {
                path: self.path.clone(),
            });
        }
        if exists {
            let permissions = fs::metadata(&self.path)
                .map_err(|source| io_error("read permissions of", &self.path, source))?
                .permissions();
            staged
                .as_file()
                .set_permissions(permissions)
                .map_err(|source| {
                    io_error("set temporary file permissions for", &self.path, source)
                })?;
        }
        staged
            .as_file()
            .sync_all()
            .map_err(|source| io_error("sync temporary file for", &self.path, source))?;
        if exists {
            staged
                .persist(&self.path)
                .map_err(|error| io_error("replace", &self.path, error.error))?;
        } else {
            staged.persist_noclobber(&self.path).map_err(|error| {
                if error.error.kind() == io::ErrorKind::AlreadyExists {
                    Error::Conflict {
                        path: self.path.clone(),
                    }
                } else {
                    io_error("create", &self.path, error.error)
                }
            })?;
        }
        self.source = candidate;
        self.resolved = resolved;

        // A failure here happens after replacement; the error states that the
        // save happened and the in-memory snapshot already reflects it.
        #[cfg(unix)]
        fs::File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|source| io_error("sync directory after saving", &self.path, source))?;
        Ok(())
    }

    fn ensure_current(&self) -> Result<bool> {
        let metadata = match fs::symlink_metadata(&self.path) {
            Ok(metadata) => metadata,
            Err(source) if source.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(source) => return Err(io_error("inspect", &self.path, source)),
        };
        if !metadata.is_file() || read_source(&self.path)? != self.source {
            return Err(Error::Conflict {
                path: self.path.clone(),
            });
        }
        Ok(true)
    }
}

fn read_snapshot(path: &Path) -> Result<(String, Value)> {
    let source = read_source(path)?;
    let resolved = resolve(path, path)?;
    if source != read_source(path)? {
        return Err(Error::Conflict { path: path.into() });
    }
    Ok((source, resolved))
}

fn read_source(path: &Path) -> Result<String> {
    fs::read_to_string(path).map_err(|source| io_error("read", path, source))
}

fn resolve(path: &Path, entry_point: &Path) -> Result<Value> {
    load::resolve(path).map_err(|source| Error::Parse {
        path: entry_point.into(),
        source,
    })
}

fn segments(path: &str) -> Result<Vec<&str>> {
    validate_path(path)?;
    Ok(path.split('.').collect())
}

fn validate_path(path: &str) -> Result<()> {
    if path.split('.').any(str::is_empty) {
        return Err(Error::InvalidPath { path: path.into() });
    }
    Ok(())
}

fn lookup<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    path.iter()
        .try_fold(value, |value, key| value.as_object()?.get(*key))
}

fn matches_value(actual: &Value, expected: &Value) -> bool {
    match (actual, expected) {
        (Value::Object(actual), Value::Object(expected)) => expected.iter().all(|(key, value)| {
            actual
                .get(key)
                .is_some_and(|actual| matches_value(actual, value))
        }),
        _ => actual == expected,
    }
}

fn io_error(operation: &'static str, path: &Path, source: io::Error) -> Error {
    Error::Io {
        operation,
        path: path.into(),
        source,
    }
}
