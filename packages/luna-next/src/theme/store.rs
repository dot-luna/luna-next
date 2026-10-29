use std::{
    collections::HashSet,
    fs, io,
    path::{Path, PathBuf},
};

use super::{ThemeEntry, Themes, values};
use crate::{
    Error, Result, config_io,
    install::{copy_tree, replace},
    io_error,
    wallpaper::{AddOptions, Library},
};

impl Themes {
    /// Validate and atomically install a folder containing theme.conf. Existing copies
    /// require `force`; source files and includes are copied without serialization.
    /// Declared wallpapers are imported without selecting one. A later install failure
    /// may leave successfully imported wallpapers in the shared library.
    pub fn install(&self, source: &Path, name: Option<&str>, force: bool) -> Result<PathBuf> {
        let source = fs::canonicalize(source)
            .map_err(|error| io_error("locate theme source", source, error))?;
        if !source.is_dir() {
            return Err(Error::Message("theme source must be a directory".into()));
        }
        let name = name
            .or_else(|| source.file_name()?.to_str())
            .ok_or_else(|| {
                Error::Message("theme directory needs a UTF-8 name; supply an explicit name".into())
            })?;
        values::name(name)?;
        let original = values::read(&source)?;
        values::resolve(&original, name)?;
        let _lock = config_io::lock(&self.paths.config_file)?;
        fs::create_dir_all(&self.paths.library_dir)
            .map_err(|error| io_error("create theme library", &self.paths.library_dir, error))?;
        let library = fs::canonicalize(&self.paths.library_dir)
            .map_err(|error| io_error("locate theme library", &self.paths.library_dir, error))?;
        if library.starts_with(&source) {
            return Err(Error::Message(
                "theme source cannot contain the theme library".into(),
            ));
        }
        let destination = library.join(name);
        match fs::symlink_metadata(&destination) {
            Ok(metadata) if !metadata.is_dir() => {
                return Err(Error::Message(
                    "installed theme must be a regular directory".into(),
                ));
            }
            Ok(_) if !force => {
                return Err(Error::Message(
                    "theme already installed; use --force to replace it".into(),
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(io_error("inspect installed theme", &destination, error)),
        }
        let staging = tempfile::tempdir_in(&library)
            .map_err(|error| io_error("stage theme", &library, error))?;
        let staged = staging.path().join("theme");
        fs::create_dir(&staged).map_err(|error| io_error("stage theme", &staged, error))?;
        copy_tree(&source, &staged, &source)?;
        let value = values::read(&staged)?;
        values::resolve(&value, name)?;
        if value != original {
            return Err(Error::Message("staged theme differs from its source; keep relative includes inside the theme folder".into()));
        }
        let targets = wallpaper_targets(&staged, &value)?;
        Library::new(self.paths.wallpaper_dir.clone()).add(&targets, &AddOptions::default())?;
        replace(&staged, &destination, &staged)?;
        Ok(destination)
    }

    /// List valid installed theme directories, sorted by name. Missing libraries are empty.
    pub fn list(&self) -> Result<Vec<ThemeEntry>> {
        let current = self.current()?;
        let entries = match fs::read_dir(&self.paths.library_dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => {
                return Err(io_error(
                    "read theme library",
                    &self.paths.library_dir,
                    error,
                ));
            }
        };
        let mut names = Vec::new();
        for entry in entries {
            let entry = entry
                .map_err(|error| io_error("read theme library", &self.paths.library_dir, error))?;
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if values::name(&name).is_ok()
                && entry
                    .file_type()
                    .map_err(|error| io_error("inspect installed theme", &entry.path(), error))?
                    .is_dir()
                && entry.path().join("theme.conf").is_file()
            {
                names.push(name);
            }
        }
        names.sort();
        Ok(names
            .into_iter()
            .map(|name| ThemeEntry {
                current: current.as_deref() == Some(&name),
                name,
            })
            .collect())
    }

    /// Validate a whole removal batch, protecting the selected theme and external paths.
    pub fn removal_plan(&self, names: &[String]) -> Result<Vec<PathBuf>> {
        let current = self.current()?;
        let mut seen = HashSet::new();
        let mut paths = Vec::new();
        for name in names {
            if current.as_deref() == Some(name) {
                return Err(Error::Message(
                    "select another theme before removing the current one".into(),
                ));
            }
            let path = self.path(name)?;
            if seen.insert(path.clone()) {
                paths.push(path);
            }
        }
        Ok(paths)
    }

    /// Remove installed copies without prompting. Source folders and imported wallpapers
    /// remain. Validation completes before any deletion; I/O errors can leave a partial batch.
    pub fn remove(&self, names: &[String]) -> Result<Vec<PathBuf>> {
        let _lock = config_io::lock(&self.paths.config_file)?;
        let paths = self.removal_plan(names)?;
        for path in &paths {
            fs::remove_dir_all(path)
                .map_err(|error| io_error("remove installed theme", path, error))?;
        }
        Ok(paths)
    }
}

fn wallpaper_targets(root: &Path, source: &serde_json::Value) -> Result<Vec<String>> {
    let mut targets = Vec::new();
    for value in source["wallpaper"]["sources"]
        .as_array()
        .into_iter()
        .flatten()
    {
        let value = value.as_str().expect("validated wallpaper source");
        if value.starts_with("http://") || value.starts_with("https://") {
            targets.push(value.to_owned());
            continue;
        }
        let path = Path::new(value);
        if path.is_absolute() {
            return Err(Error::Message(
                "theme wallpaper paths must be relative".into(),
            ));
        }
        let path = fs::canonicalize(root.join(path))
            .map_err(|error| io_error("locate theme wallpaper", &root.join(path), error))?;
        if !path.starts_with(root) {
            return Err(Error::Message("theme wallpaper escapes its folder".into()));
        }
        targets.push(
            path.to_str()
                .ok_or_else(|| Error::Message("wallpaper paths must be UTF-8".into()))?
                .to_owned(),
        );
    }
    Ok(targets)
}
