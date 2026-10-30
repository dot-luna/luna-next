//! Login screen library and explicit, self-contained SDDM theme snapshots.
//! Configuration edits only change the user source; building never contacts SDDM.

mod bundle;
mod config;
mod deploy;
mod paths;
mod runtime;
mod screens;

pub use deploy::{DeploymentPaths, deploy, deploy_system};
pub use paths::Paths;

use crate::{Error, Result, io_error};
use serde::Serialize;
use std::path::Path;

/// An available QML screen and its saved-selection marker.
#[derive(Debug, Serialize)]
pub struct ScreenEntry {
    pub name: String,
    pub current: bool,
}

/// Owns login configuration and screen copies without requiring a greeter session.
pub struct Login {
    pub(super) paths: Paths,
}

impl Login {
    /// Select application paths without reading configuration or changing SDDM.
    pub fn from_env() -> Result<Self> {
        Self::new(Paths::from_env()?)
    }

    /// Use explicit nonempty paths, resolving relative paths against the working directory.
    pub fn new(mut paths: Paths) -> Result<Self> {
        for path in [
            &mut paths.config_file,
            &mut paths.screens_dir,
            &mut paths.app_dir,
        ] {
            if path.as_os_str().is_empty() {
                return Err(Error::Message("login paths must not be empty".into()));
            }
            *path = std::path::absolute(&*path).map_err(|error| io_error("locate", path, error))?;
        }
        Ok(Self { paths })
    }

    pub fn config_file(&self) -> &Path {
        &self.paths.config_file
    }

    pub fn directory(&self) -> &Path {
        &self.paths.screens_dir
    }
}
