use super::{Login, ScreenEntry, config, paths};
use crate::{
    Error, Result, config_io,
    install::{copy_tree, replace},
    io_error,
};
use std::{
    collections::BTreeSet,
    fs, io,
    path::{Path, PathBuf},
};

impl Login {
    /// Copy a folder containing `Screen.qml` into the screen library atomically.
    /// `default` is reserved. Existing copies require `force`; links may only point
    /// to regular files inside the source tree and are copied as ordinary files.
    pub fn install(&self, source: &Path, name: Option<&str>, force: bool) -> Result<PathBuf> {
        let source = fs::canonicalize(source)
            .map_err(|error| io_error("locate login screen", source, error))?;
        let name = name
            .or_else(|| source.file_name()?.to_str())
            .ok_or_else(|| {
                Error::Message(
                    "screen directory needs a UTF-8 name; supply an explicit name".into(),
                )
            })?;
        config::validate_name(name)?;
        if name == "default" {
            return Err(Error::Message(
                "default is reserved for the built-in login screen".into(),
            ));
        }
        validate_screen(&source)?;
        let _lock = config_io::lock(&self.paths.config_file)?;
        let library = paths::identity(&self.paths.screens_dir)?;
        let destination = library.join(name);
        if library.starts_with(&source) || paths::overlaps(&source, &destination) {
            return Err(Error::Message(
                "login screen source overlaps its installation destination".into(),
            ));
        }
        match fs::symlink_metadata(&destination) {
            Ok(metadata) if !metadata.is_dir() => {
                return Err(Error::Message(
                    "installed screen must be a regular directory".into(),
                ));
            }
            Ok(_) if !force => {
                return Err(Error::Message(
                    "screen already installed; use --force to replace it".into(),
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(io_error("inspect installed screen", &destination, error)),
        }
        fs::create_dir_all(&library)
            .map_err(|error| io_error("create login screen library", &library, error))?;
        let staging = tempfile::tempdir_in(&library)
            .map_err(|error| io_error("stage login screen", &library, error))?;
        let staged = staging.path().join("screen");
        fs::create_dir(&staged).map_err(|error| io_error("stage login screen", &staged, error))?;
        copy_tree(&source, &staged, &source)?;
        validate_screen(&staged)?;
        replace(&staged, &destination, &staged)?;
        Ok(destination)
    }

    /// List available screen directories in name order, including the built-in default.
    /// Invalid entries and symlink directories are omitted; a missing library is empty.
    pub fn list(&self) -> Result<Vec<ScreenEntry>> {
        let current = self.current()?;
        let mut names = BTreeSet::new();
        if validate_screen(&self.paths.app_dir.join("screens/default")).is_ok() {
            names.insert("default".to_owned());
        }
        match fs::read_dir(&self.paths.screens_dir) {
            Ok(entries) => {
                for entry in entries {
                    let entry = entry.map_err(|error| {
                        io_error("read login screen library", &self.paths.screens_dir, error)
                    })?;
                    let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                        continue;
                    };
                    if name != "default"
                        && config::validate_name(&name).is_ok()
                        && validate_screen(&entry.path()).is_ok()
                    {
                        names.insert(name);
                    }
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(io_error(
                    "read login screen library",
                    &self.paths.screens_dir,
                    error,
                ));
            }
        }
        Ok(names
            .into_iter()
            .map(|name| ScreenEntry {
                current: name == current,
                name,
            })
            .collect())
    }

    pub(super) fn screen_path(&self, name: &str) -> Result<PathBuf> {
        config::validate_name(name)?;
        let path = if name == "default" {
            self.paths.app_dir.join("screens/default")
        } else {
            self.paths.screens_dir.join(name)
        };
        validate_screen(&path)?;
        fs::canonicalize(&path).map_err(|error| io_error("locate login screen", &path, error))
    }
}

fn validate_screen(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| io_error("inspect login screen", path, error))?;
    if !metadata.is_dir() {
        return Err(Error::Message(format!(
            "login screen must be a regular directory: {}",
            path.display()
        )));
    }
    let root =
        fs::canonicalize(path).map_err(|error| io_error("locate login screen", path, error))?;
    validate_tree(&root, &root)?;
    if !root.join("Screen.qml").is_file() {
        return Err(Error::Message("login screen requires Screen.qml".into()));
    }
    Ok(())
}

/// Only contained regular files are allowed; rejecting directory links also prevents loops.
pub(super) fn validate_tree(directory: &Path, root: &Path) -> Result<()> {
    for entry in
        fs::read_dir(directory).map_err(|error| io_error("read login source", directory, error))?
    {
        let entry = entry.map_err(|error| io_error("read login source", directory, error))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| io_error("inspect login source", &path, error))?;
        if metadata.is_dir() {
            validate_tree(&path, root)?;
        } else {
            let resolved = fs::canonicalize(&path)
                .map_err(|error| io_error("locate login source", &path, error))?;
            if !resolved.starts_with(root) || !resolved.is_file() {
                return Err(Error::Message(format!(
                    "login source must be a file inside its folder: {}",
                    path.display()
                )));
            }
        }
    }
    Ok(())
}
