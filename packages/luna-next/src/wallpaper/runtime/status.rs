use super::paths::canonical_path;
use super::process::command_error;
use super::{POLL_INTERVAL, Runtime, Status};
use crate::{Error, Result};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

const START_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Deserialize)]
pub(super) struct Instance {
    config_path: PathBuf,
    pub(super) pid: u32,
}

impl Runtime {
    pub(super) fn instances(&self, path: &Path) -> Result<Vec<Instance>> {
        let output = self.run(&["list".into(), "-a".into(), "-j".into()], false)?;
        if !output.status.success() {
            return Err(command_error("list Quickshell instances", &output));
        }
        let text = output.stdout.trim();
        // Quickshell emits this text rather than JSON when no instance exists.
        if text.is_empty() || text == "No running instances." {
            return Ok(Vec::new());
        }
        let all: Vec<Instance> = serde_json::from_str(text).map_err(|error| {
            Error::Message(format!("Invalid Quickshell instance list: {error}"))
        })?;
        let mut matches = Vec::new();
        for instance in all {
            if canonical_path(&instance.config_path)? == path {
                if instance.pid == 0 {
                    return Err(Error::Message("Invalid wallpaper process ID".into()));
                }
                matches.push(instance);
            }
        }
        Ok(matches)
    }

    pub(super) fn status_at(&self, path: &Path) -> Result<Status> {
        let instances = self.instances(path)?;
        if instances.is_empty() {
            return Ok(Status::Stopped);
        }
        let mut status = Status::Ready;
        for instance in instances {
            let output = self.run(
                &[
                    "ipc".into(),
                    "--pid".into(),
                    instance.pid.to_string().into(),
                    "call".into(),
                    "wallpaper".into(),
                    "status".into(),
                ],
                false,
            )?;
            // IPC registration can lag behind the process listing at startup.
            if !output.status.success() {
                status = Status::Loading;
                continue;
            }
            match output.stdout.trim() {
                "ready" => (),
                "loading" => status = Status::Loading,
                "error" => return Ok(Status::Error),
                value => {
                    return Err(Error::Message(format!(
                        "Invalid wallpaper status: {value:?}"
                    )));
                }
            }
        }
        Ok(status)
    }

    pub(super) fn wait_ready(&self, path: &Path) -> Result<Status> {
        let deadline = Instant::now() + START_TIMEOUT;
        // Daemon registration can lag behind launch; only treat its later disappearance as exit.
        let mut registered = false;
        loop {
            match self.status_at(path)? {
                Status::Ready => return Ok(Status::Ready),
                Status::Error => {
                    return Err(Error::Message(
                        "Wallpaper could not load its configuration or media; check its Quickshell logs"
                            .into(),
                    ));
                }
                Status::Loading => registered = true,
                Status::Stopped if registered => {
                    return Err(Error::Message(
                        "Wallpaper renderer exited before becoming ready".into(),
                    ));
                }
                Status::Stopped => (),
            }
            if Instant::now() >= deadline {
                return Err(Error::Message(
                    "Wallpaper renderer did not become ready within sixty seconds".into(),
                ));
            }
            thread::sleep(POLL_INTERVAL);
        }
    }
}
