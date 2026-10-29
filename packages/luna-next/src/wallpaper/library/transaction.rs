use super::files::destination_exists;
use super::{Library, STAGING_PREFIX, message};
use crate::{Error, Result, io_error};
use std::fs::{self, File, OpenOptions};
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tempfile::TempDir;

impl Library {
    pub(super) fn transaction(&self) -> Result<TempDir> {
        tempfile::Builder::new()
            .prefix(STAGING_PREFIX)
            .tempdir_in(&self.directory)
            .map_err(|error| io_error("stage wallpaper changes", &self.directory, error))
    }

    pub(super) fn lock(&self) -> Result<File> {
        let path = self.directory.join(format!("{STAGING_PREFIX}lock"));
        destination_exists(&path)?;
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&path)
            .map_err(|error| io_error("lock wallpaper library", &path, error))?;
        let started = Instant::now();
        // The persistent path keeps later callers on the same lock inode after this handle drops.
        loop {
            match file.try_lock() {
                Ok(()) => return Ok(file),
                Err(std::fs::TryLockError::WouldBlock)
                    if started.elapsed() < Duration::from_millis(500) =>
                {
                    std::thread::sleep(Duration::from_millis(5));
                }
                Err(std::fs::TryLockError::WouldBlock) => {
                    return Err(message(
                        "Wallpaper library is busy; another operation is in progress",
                    ));
                }
                Err(std::fs::TryLockError::Error(error)) => {
                    return Err(io_error("lock wallpaper library", &path, error));
                }
            }
        }
    }
}

/// Undo committed entries in reverse order; retain recovery files if restoration is incomplete.
pub(super) fn rollback(
    transaction: TempDir,
    committed: &[(PathBuf, Option<PathBuf>, bool)],
    original: Error,
) -> Error {
    let mut failures = Vec::new();
    for (destination, backup, installed) in committed.iter().rev() {
        if *installed {
            match fs::remove_file(destination) {
                Ok(()) => (),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
                Err(error) => failures.push(format!("{}: {error}", destination.display())),
            }
        }
        if let Some(backup) = backup {
            // Keep recovery files instead of overwriting a concurrent external change.
            if destination.exists() || destination.is_symlink() {
                failures.push(format!(
                    "{} appeared during rollback",
                    destination.display()
                ));
            } else if let Err(error) = fs::rename(backup, destination) {
                failures.push(format!("{}: {error}", destination.display()));
            }
        }
    }
    if failures.is_empty() {
        original
    } else {
        let recovery = transaction.keep();
        message(format!(
            "{original}; rollback failed: {}; recovery files: {}",
            failures.join("; "),
            recovery.display()
        ))
    }
}
