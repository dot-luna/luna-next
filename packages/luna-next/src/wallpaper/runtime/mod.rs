//! Quickshell process control, scoped to this renderer's canonical entry point.

mod paths;
mod process;
mod status;

use crate::{Error, Result, io_error};
use paths::canonical_path;
use process::{command_error, quickshell};
use serde::Serialize;
use std::env;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

const STOP_TIMEOUT: Duration = Duration::from_secs(5);
const POLL_INTERVAL: Duration = Duration::from_millis(100);

/// Lifecycle state reported by matching renderer instances.
/// `Loading` also covers a listed process whose IPC endpoint is not registered yet.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Stopped,
    Loading,
    Ready,
    Error,
}

/// Controls this wallpaper renderer without affecting other Quickshell apps.
/// [`super::Wallpaper`] adds Rust-side config validation, mutation locks, and rollback.
#[derive(Clone, Debug)]
pub struct Runtime {
    renderer: PathBuf,
    config_file: PathBuf,
}

impl Runtime {
    pub fn new(renderer: PathBuf, config_file: PathBuf) -> Self {
        Self {
            renderer,
            config_file,
        }
    }

    /// Return `Error` if any renderer reports failure, or `Ready` once all are ready.
    pub fn status(&self) -> Result<Status> {
        let path = self.renderer_path()?;
        self.status_at(&path)
    }

    /// Reuse a running renderer without reloading it, or start one and wait for its media.
    /// A fresh launch requires Wayland and an installed renderer entry point.
    pub fn start(&self) -> Result<Status> {
        let path = self.renderer_path()?;
        if self.instances(&path)?.is_empty() {
            self.check_launch_context(&path)?;
            let output = self.run(
                &[
                    "-p".into(),
                    path.as_os_str().to_owned(),
                    "--daemonize".into(),
                    "--no-duplicate".into(),
                ],
                true,
            )?;
            if !output.status.success() {
                return Err(command_error("start wallpaper", &output));
            }
        }
        self.wait_ready(&path)
    }

    /// Stops only matching renderer instances and waits for their shutdown.
    pub fn stop(&self) -> Result<Status> {
        let path = self.renderer_path()?;
        for instance in self.instances(&path)? {
            let output = self.run(
                &[
                    "kill".into(),
                    "--pid".into(),
                    instance.pid.to_string().into(),
                ],
                false,
            )?;
            if !output.status.success()
                && self
                    .instances(&path)?
                    .iter()
                    .any(|other| other.pid == instance.pid)
            {
                return Err(command_error("stop wallpaper", &output));
            }
        }
        let deadline = Instant::now() + STOP_TIMEOUT;
        loop {
            if self.instances(&path)?.is_empty() {
                return Ok(Status::Stopped);
            }
            if Instant::now() >= deadline {
                return Err(Error::Message(
                    "Wallpaper renderer did not stop within five seconds".into(),
                ));
            }
            thread::sleep(POLL_INTERVAL);
        }
    }

    /// Replaces the renderer process and waits for its media.
    pub fn restart(&self) -> Result<Status> {
        let path = self.renderer_path()?;
        self.check_launch_context(&path)?;
        self.stop()?;
        self.start()
    }

    /// Apply saved configuration by IPC without replacing renderer processes, or start if stopped.
    /// Wait for media readiness after acceptance. This low-level operation does not restore
    /// configuration after failure; [`super::Wallpaper::update_config`] owns mutation recovery.
    pub fn reload(&self) -> Result<Status> {
        let path = self.renderer_path()?;
        let instances = self.instances(&path)?;
        if instances.is_empty() {
            return self.start();
        }
        let config_file = self.config_path()?;
        for instance in instances {
            let output = self.run(
                &[
                    "ipc".into(),
                    "--pid".into(),
                    instance.pid.to_string().into(),
                    "call".into(),
                    "wallpaper".into(),
                    "reload".into(),
                    config_file.as_os_str().to_owned(),
                ],
                false,
            )?;
            if !output.status.success() {
                return Err(command_error("reload wallpaper", &output));
            }
            let response = output.stdout.trim();
            if response != "ok" {
                return Err(Error::Message(format!(
                    "Could not reload wallpaper: {response:?}"
                )));
            }
        }
        self.wait_ready(&path)
    }

    fn renderer_path(&self) -> Result<PathBuf> {
        canonical_path(&if self.renderer.is_dir() {
            self.renderer.join("shell.qml")
        } else {
            self.renderer.clone()
        })
    }

    fn config_path(&self) -> Result<PathBuf> {
        std::path::absolute(&self.config_file)
            .map_err(|error| io_error("resolve configuration path", &self.config_file, error))
    }

    fn check_launch_context(&self, path: &Path) -> Result<()> {
        if env::var_os("WAYLAND_DISPLAY").is_none_or(|value| value.is_empty()) {
            return Err(Error::Message(
                "Wallpaper rendering requires a Wayland session".into(),
            ));
        }
        if !path.is_file() {
            return Err(Error::Message(format!(
                "Wallpaper renderer not found: {}",
                path.display()
            )));
        }
        quickshell()?;
        Ok(())
    }
}
