mod download;
mod files;
mod import;
mod process;
mod transaction;

use crate::{Error, Result, io_error};
use files::{canonicalize, destination_exists, media_type, resolve_target, scan};
use process::run;
use rand::seq::IndexedRandom;
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;
use transaction::rollback;

const STAGING_PREFIX: &str = ".luna-next-media-";

#[derive(Clone, Debug, Default)]
pub struct AddOptions {
    /// Recurse into source folders; direct file and URL imports are unaffected.
    pub recursive: bool,
    /// Replace differing installed files with the same name; identical content is skipped.
    pub force: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct ImportResult {
    pub path: PathBuf,
    /// False when an installed file already has identical contents.
    pub added: bool,
}

/// Wallpaper files, independent of configuration and renderer control.
#[derive(Clone, Debug)]
pub struct Library {
    directory: PathBuf,
}

impl Library {
    /// Store a library location without creating or scanning it.
    pub fn new(directory: PathBuf) -> Self {
        Self { directory }
    }

    pub fn directory(&self) -> &Path {
        &self.directory
    }

    /// Return sorted regular-file paths recursively, excluding symlinks and staging entries.
    /// A missing library is empty and is not created by this read.
    pub fn list(&self) -> Result<Vec<PathBuf>> {
        match fs::metadata(&self.directory) {
            Ok(metadata) if metadata.is_dir() => {
                let root = canonicalize(&self.directory)?;
                scan(&root, true, false)
            }
            Ok(_) => Err(message(format!(
                "Wallpaper library is not a directory: {}",
                self.directory.display()
            ))),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(error) => Err(io_error("read wallpaper library", &self.directory, error)),
        }
    }

    /// Resolve a unique library basename or path; ambiguous basenames are errors.
    /// With `library_only = false`, an existing external file is also accepted.
    /// Resolution does not inspect media contents; use [`Self::validate`] for that.
    pub fn resolve(&self, target: &str, library_only: bool) -> Result<PathBuf> {
        resolve_target(target, library_only, &self.list()?)
    }

    /// Require an image/video MIME type from `file`; decoding is left to the renderer.
    pub fn validate(&self, path: &Path) -> Result<()> {
        media_type(path).map(|_| ())
    }

    /// Choose a library file, excluding `current` when another choice exists.
    /// Returns an error for an empty library.
    pub fn random(&self, current: Option<&Path>) -> Result<PathBuf> {
        let mut choices = self.list()?;
        if choices.len() > 1 {
            let current = current.and_then(|path| fs::canonicalize(path).ok());
            choices.retain(|path| Some(path) != current.as_ref());
        }
        choices
            .choose(&mut rand::rng())
            .cloned()
            .ok_or_else(|| message("Wallpaper library is empty"))
    }

    /// Resolve and deduplicate removals without reserving or changing files.
    /// Only library entries other than the caller-supplied current path are allowed.
    pub fn removal_plan(&self, targets: &[String], current: Option<&Path>) -> Result<Vec<PathBuf>> {
        let current = current.and_then(|path| fs::canonicalize(path).ok());
        let entries = self.list()?;
        let mut seen = HashSet::new();
        let mut paths = Vec::new();
        for target in targets {
            let path = resolve_target(target, true, &entries)?;
            if Some(&path) == current.as_ref() {
                return Err(message(
                    "Select another wallpaper before removing the current one",
                ));
            }
            if seen.insert(path.clone()) {
                paths.push(path);
            }
        }
        Ok(paths)
    }

    /// Validate the whole batch under the library lock, then remove it without prompts.
    /// Failures attempt rollback; incomplete recovery reports a staging directory to inspect.
    pub fn remove(&self, targets: &[String], current: Option<&Path>) -> Result<Vec<PathBuf>> {
        if targets.is_empty() {
            return Ok(Vec::new());
        }
        let _lock = self.lock()?;
        let paths = self.removal_plan(targets, current)?;
        if paths.is_empty() {
            return Ok(paths);
        }
        let transaction = self.transaction()?;
        let mut moved = Vec::new();
        for (index, path) in paths.iter().enumerate() {
            // Reject destinations that disappeared or became links after planning.
            if let Err(error) = destination_exists(path).and_then(|exists| {
                if !exists {
                    return Err(message(format!(
                        "Wallpaper disappeared: {}",
                        path.display()
                    )));
                }
                let backup = transaction.path().join(index.to_string());
                fs::rename(path, &backup)
                    .map_err(|error| io_error("remove wallpaper", path, error))?;
                moved.push((path.clone(), Some(backup), false));
                Ok(())
            }) {
                return Err(rollback(transaction, &moved, error));
            }
        }
        Ok(paths)
    }

    /// Create the library if needed and open it with `xdg-open`.
    pub fn open_directory(&self) -> Result<()> {
        fs::create_dir_all(&self.directory)
            .map_err(|error| io_error("create wallpaper library", &self.directory, error))?;
        let path = canonicalize(&self.directory)?;
        let mut command = Command::new("xdg-open");
        command.arg(path);
        run(&mut command, Duration::from_secs(15)).map(|_| ())
    }
}

fn message(value: impl Into<String>) -> Error {
    Error::Message(value.into())
}
