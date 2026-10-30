//! Session-owned authentication agent. Passwords stay inside Quickshell's native
//! polkit conversation; lifecycle IPC exposes only registration status.

mod service;

use std::{env, path::PathBuf};

use serde::Serialize;

use crate::{Error, Result, io_error};

pub const UNIT: &str = "luna-next-polkit.service";

/// Installed QML entry point and user-service definition. Neither is generated here.
#[derive(Clone, Debug)]
pub struct Paths {
    pub shell_path: PathBuf,
    pub service_file: PathBuf,
}

impl Paths {
    /// Use XDG homes and an optional nonempty `LUNA_NEXT_POLKIT_SHELL` override.
    /// Unset or empty homes fall back to `~/.local/share` and `~/.config`.
    pub fn from_env() -> Result<Self> {
        let shell_path = match env::var_os("LUNA_NEXT_POLKIT_SHELL")
            .filter(|value| !value.is_empty())
        {
            Some(value) => value.into(),
            None => base("XDG_DATA_HOME", ".local/share")?.join("luna-next/polkit/shell/shell.qml"),
        };
        Ok(Self {
            shell_path,
            service_file: base("XDG_CONFIG_HOME", ".config")?
                .join("systemd/user")
                .join(UNIT),
        })
    }
}

fn base(variable: &str, fallback: &str) -> Result<PathBuf> {
    if let Some(value) = env::var_os(variable).filter(|value| !value.is_empty()) {
        return Ok(value.into());
    }
    env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(|home| PathBuf::from(home).join(fallback))
        .ok_or_else(|| Error::Message(format!("{variable} or HOME must be set")))
}

/// `Running` requires native polkit registration, rather than only a live process.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Running,
    Unavailable,
    Stopped,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Unavailable => "unavailable",
            Self::Stopped => "stopped",
        }
    }
}

/// Control only Luna Next's installed user service. Other authentication agents
/// are never stopped, masked, or replaced by these operations.
#[derive(Clone, Debug)]
pub struct Polkit {
    paths: Paths,
}

impl Polkit {
    pub fn from_env() -> Result<Self> {
        Self::new(Paths::from_env()?)
    }

    /// Select explicit nonempty paths without starting or stopping anything.
    /// Relative paths resolve against the current working directory.
    pub fn new(mut paths: Paths) -> Result<Self> {
        for path in [&mut paths.shell_path, &mut paths.service_file] {
            if path.as_os_str().is_empty() {
                return Err(Error::Message("polkit paths must not be empty".into()));
            }
            *path = std::path::absolute(&*path)
                .map_err(|error| io_error("resolve polkit path", path, error))?;
        }
        if paths.shell_path.is_file() {
            paths.shell_path = std::fs::canonicalize(&paths.shell_path)
                .map_err(|error| io_error("locate polkit shell", &paths.shell_path, error))?;
        }
        Ok(Self { paths })
    }

    pub fn paths(&self) -> &Paths {
        &self.paths
    }
}
