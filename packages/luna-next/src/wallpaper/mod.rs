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

/// A library file and whether its canonical path matches the configured selection.
#[derive(Debug, Serialize)]
pub struct WallpaperEntry {
    pub path: PathBuf,
    pub current: bool,
}

/// Coordinates configuration, media imports, and this app's renderer.
/// Mutations use advisory locks shared by other clients of this API.
pub struct Wallpaper {
    paths: Paths,
    library: Library,
    runtime: Runtime,
}

impl Wallpaper {
    /// Select paths from the application environment without loading configuration.
    pub fn from_env() -> Result<Self> {
        Self::new(Paths::from_env()?)
    }

    /// Use explicit, nonempty paths, resolving relative paths against the current directory.
    /// Files and directories need not exist until an operation uses them.
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

    /// Import local files, folders, or HTTP(S) URLs into the library.
    /// Replacing the selected media restarts a running renderer to reopen the file.
    /// An application failure is reported after import; imported files remain installed.
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

    /// List library files with their current-selection marker; configuration must be valid.
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

    /// Select a library name or local file, validate its media type, and apply the config.
    /// Returns the full effective configuration, with [`Self::update_config`] recovery rules.
    pub fn set(&self, target: &str) -> Result<Value> {
        let _lock = self.lock_config()?;
        let path = self.library.resolve(target, false)?;
        self.library.validate(&path)?;
        self.update_locked(&json!({"wallpaper": {"source": path}}))
    }

    /// Select and apply a random library file, avoiding the current one when possible.
    /// An empty library is an error; application and recovery match [`Self::set`].
    pub fn random(&self) -> Result<Value> {
        let _lock = self.lock_config()?;
        let path = self.library.random(self.current()?.as_deref())?;
        self.library.validate(&path)?;
        self.update_locked(&json!({"wallpaper": {"source": path}}))
    }

    /// Preview deduplicated removals, rejecting external files and the current selection.
    /// The preview does not reserve files; [`Self::remove`] validates them again.
    pub fn removal_plan(&self, names: &[String]) -> Result<Vec<PathBuf>> {
        self.library.removal_plan(names, self.current()?.as_deref())
    }

    /// Remove a validated batch of library files without prompting.
    /// The configured selection and external files cannot be removed.
    pub fn remove(&self, names: &[String]) -> Result<Vec<PathBuf>> {
        let _lock = self.lock_config()?;
        self.library.remove(names, self.current()?.as_deref())
    }

    pub fn open_directory(&self) -> Result<()> {
        self.library.open_directory()
    }
    /// Validate saved settings, reuse or start the renderer, and wait for ready media.
    pub fn start(&self) -> Result<Status> {
        let _lock = self.lock_config()?;
        self.get_config(None)?;
        self.runtime.start()
    }
    /// Stop this renderer even if its configuration no longer parses.
    pub fn stop(&self) -> Result<Status> {
        let _lock = self.lock_config()?;
        self.runtime.stop()
    }
    /// Validate settings, replace the renderer process, and wait for ready media.
    pub fn restart(&self) -> Result<Status> {
        let _lock = self.lock_config()?;
        self.get_config(None)?;
        self.runtime.restart()
    }
    /// Validate and reread saved settings in place, starting the renderer if stopped.
    /// This explicit operation does not watch files or restore invalid edits on disk.
    pub fn reload(&self) -> Result<Status> {
        let _lock = self.lock_config()?;
        self.get_config(None)?;
        self.runtime.reload()
    }
    pub fn status(&self) -> Result<Status> {
        self.runtime.status()
    }
}
