//! File creation, snapshot checks, and atomic persistence for configuration edits.

use std::fs;
use std::io::{self, Write};
use std::path::Path;

use serde_json::Value;

use crate::{Config, Error, Result, edit, load, validate_path};

pub(super) fn open(path: &Path) -> Result<Config> {
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
    Ok(Config {
        path,
        source,
        resolved,
    })
}

impl Config {
    pub(super) fn modify_many(
        &mut self,
        changes: &[(&str, Option<&Value>)],
        validate: impl FnOnce(&Value) -> Result<()>,
    ) -> Result<()> {
        let operations = changes
            .iter()
            .map(|(path, value)| Ok((*path, segments(path)?, *value)))
            .collect::<Result<Vec<_>>>()?;
        let exists = self.ensure_current()?;
        let source = if exists { &self.source } else { "" };
        let mut candidate = source.to_owned();
        for (_, segments, value) in &operations {
            candidate = edit::apply(&candidate, segments, *value)?;
        }
        if candidate == source {
            return validate(&self.resolved);
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
        validate(&resolved)?;
        for (path, segments, value) in &operations {
            if let Some(expected) = value
                && !lookup(&resolved, segments)
                    .is_some_and(|actual| matches_value(actual, expected))
            {
                return Err(Error::Edit {
                    message: format!("'{path}' did not resolve to the requested value"),
                });
            }
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
