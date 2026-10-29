use crate::{Error, Result, io_error};
use std::env;
use std::fs;
use std::path::{Component, Path, PathBuf};

/// Missing installation paths still have a stable identity for status and stop.
pub(super) fn canonical_path(path: &Path) -> Result<PathBuf> {
    let absolute = if path.is_absolute() {
        path.to_owned()
    } else {
        env::current_dir()
            .map_err(|error| io_error("resolve renderer path", path, error))?
            .join(path)
    };
    let mut existing = absolute.as_path();
    let mut missing = Vec::new();
    loop {
        match fs::canonicalize(existing) {
            Ok(mut resolved) => {
                for suffix in missing.iter().rev() {
                    resolved.push(suffix);
                }
                let mut cleaned = PathBuf::new();
                for component in resolved.components() {
                    match component {
                        Component::CurDir => (),
                        Component::ParentDir => {
                            cleaned.pop();
                        }
                        value => cleaned.push(value),
                    }
                }
                return Ok(cleaned);
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let Some(name) = existing.file_name() else {
                    return Err(io_error("resolve renderer path", path, error));
                };
                missing.push(name.to_owned());
                existing = existing.parent().ok_or_else(|| {
                    Error::Message(format!("Invalid renderer path: {}", path.display()))
                })?;
            }
            Err(error) => return Err(io_error("resolve renderer path", path, error)),
        }
    }
}
