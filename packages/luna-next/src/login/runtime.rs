use std::{io, path::Path, path::PathBuf, process::Command};

use super::{DeploymentPaths, Login};
use crate::{Error, Result, io_error};

impl Login {
    /// Build a temporary snapshot and open the Qt 6 SDDM test greeter until it exits.
    /// Test mode does not perform authentication or power actions. No system files change.
    pub fn preview(&self) -> Result<()> {
        let stage = tempfile::tempdir()
            .map_err(|error| io_error("stage login preview", self.directory(), error))?;
        let bundle = self.build(&stage.path().join("theme"))?;
        let status = Command::new("sddm-greeter-qt6")
            .args(["--test-mode", "--theme"])
            .arg(bundle)
            .stdout(io::stderr())
            .status()
            .map_err(|error| Error::Message(format!("cannot start SDDM preview: {error}")))?;
        if !status.success() {
            return Err(Error::Message(format!("SDDM preview failed ({status})")));
        }
        Ok(())
    }

    /// Prepare settings as the caller, then elevate only the fixed-destination installer.
    /// `installer` must accept `login deploy BUNDLE` and publish only Luna's SDDM exports.
    /// The CLI supplies its own executable; output from sudo/the installer goes to stderr.
    /// Success affects the next greeter launch and never restarts the display manager.
    pub fn activate(&self, installer: &Path) -> Result<PathBuf> {
        let installer = std::fs::canonicalize(installer)
            .map_err(|error| io_error("locate login installer", installer, error))?;
        let stage = tempfile::tempdir()
            .map_err(|error| io_error("stage login activation", self.directory(), error))?;
        let bundle = self.build(&stage.path().join("theme"))?;
        let status = Command::new("sudo")
            .arg("--")
            .arg(installer)
            .args(["login", "deploy"])
            .arg(bundle)
            .stdout(io::stderr())
            .status()
            .map_err(|error| Error::Message(format!("cannot start login installer: {error}")))?;
        if !status.success() {
            return Err(Error::Message(format!(
                "login activation failed ({status})"
            )));
        }
        Ok(DeploymentPaths::default().theme_dir)
    }
}
