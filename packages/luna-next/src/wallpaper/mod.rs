//! Wallpaper configuration, media library, and explicit renderer control.

mod config;
mod library;
mod paths;
pub mod runtime;

pub use library::{AddOptions, ImportResult, Library};
pub use paths::Paths;
pub use runtime::{Runtime, Status};

use crate::{Error, Result, io_error};
use serde::Serialize;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
pub struct WallpaperEntry {
    pub path: PathBuf,
    pub current: bool,
}

pub struct Wallpaper {
    paths: Paths,
    library: Library,
    runtime: Runtime,
}

impl Wallpaper {
    pub fn from_env() -> Result<Self> {
        Self::new(Paths::from_env()?)
    }

    pub fn new(mut paths: Paths) -> Result<Self> {
        for path in [
            &mut paths.config_file,
            &mut paths.library_dir,
            &mut paths.renderer,
        ] {
            if path.as_os_str().is_empty() {
                return Err(Error::Message("wallpaper paths must not be empty".into()));
            }
            *path = std::path::absolute(&*path).map_err(|error| io_error("locate", path, error))?;
        }
        Ok(Self {
            library: Library::new(paths.library_dir.clone()),
            runtime: Runtime::new(paths.renderer.clone(), paths.config_file.clone()),
            paths,
        })
    }

    pub fn config_file(&self) -> &Path {
        &self.paths.config_file
    }
    pub fn directory(&self) -> &Path {
        self.library.directory()
    }

    pub fn add(&self, targets: &[String], options: &AddOptions) -> Result<Vec<ImportResult>> {
        let _lock = self.lock_config()?;
        let current = self.current()?;
        let result = self.library.add(targets, options)?;
        if result
            .iter()
            .any(|entry| entry.added && current.as_deref() == Some(entry.path.as_path()))
            && self.runtime.status()? != Status::Stopped
        {
            self.runtime.restart().map_err(|error| {
                Error::Message(format!("media imported, but applying it failed: {error}"))
            })?;
        }
        Ok(result)
    }

    pub fn list(&self) -> Result<Vec<WallpaperEntry>> {
        let current = self.current()?;
        Ok(self
            .library
            .list()?
            .into_iter()
            .map(|path| WallpaperEntry {
                current: current.as_deref() == Some(path.as_path()),
                path,
            })
            .collect())
    }

    pub fn set(&self, target: &str) -> Result<Value> {
        let _lock = self.lock_config()?;
        let path = self.library.resolve(target, false)?;
        self.library.validate(&path)?;
        self.update_locked(&json!({"wallpaper": {"source": path}}))
    }

    pub fn random(&self) -> Result<Value> {
        let _lock = self.lock_config()?;
        let path = self.library.random(self.current()?.as_deref())?;
        self.library.validate(&path)?;
        self.update_locked(&json!({"wallpaper": {"source": path}}))
    }

    pub fn removal_plan(&self, names: &[String]) -> Result<Vec<PathBuf>> {
        self.library.removal_plan(names, self.current()?.as_deref())
    }

    pub fn remove(&self, names: &[String]) -> Result<Vec<PathBuf>> {
        let _lock = self.lock_config()?;
        self.library.remove(names, self.current()?.as_deref())
    }

    pub fn open_directory(&self) -> Result<()> {
        self.library.open_directory()
    }
    pub fn start(&self) -> Result<Status> {
        let _lock = self.lock_config()?;
        self.get_config(None)?;
        self.runtime.start()
    }
    pub fn stop(&self) -> Result<Status> {
        let _lock = self.lock_config()?;
        self.runtime.stop()
    }
    pub fn restart(&self) -> Result<Status> {
        let _lock = self.lock_config()?;
        self.get_config(None)?;
        self.runtime.restart()
    }
    pub fn reload(&self) -> Result<Status> {
        let _lock = self.lock_config()?;
        self.get_config(None)?;
        self.runtime.reload()
    }
    pub fn status(&self) -> Result<Status> {
        self.runtime.status()
    }
}
