use crate::{Error, Result};
use std::{env, path::PathBuf};

/// Application-selected paths; [`super::Wallpaper::new`] resolves them to absolute paths.
#[derive(Debug, Clone)]
pub struct Paths {
    pub config_file: PathBuf,
    pub library_dir: PathBuf,
    pub renderer: PathBuf,
}

impl Paths {
    /// Honor nonempty `LUNA_WALLPAPER_CONFIG` and `LUNA_WALLPAPER_SHELL` overrides.
    /// Otherwise use XDG config/data paths, falling back to `~/.config` and
    /// `~/.local/share`; the library lives at `luna-next/wallpapers` in the data path.
    pub fn from_env() -> Result<Self> {
        let config_file = match nonempty_env("LUNA_WALLPAPER_CONFIG") {
            Some(path) => PathBuf::from(path),
            None => base_dir("XDG_CONFIG_HOME", ".config")?.join("luna-next/wallpaper.conf"),
        };
        let data = base_dir("XDG_DATA_HOME", ".local/share")?;
        let renderer = nonempty_env("LUNA_WALLPAPER_SHELL")
            .map(PathBuf::from)
            .unwrap_or_else(|| data.join("luna-next/wallpaper/shell/shell.qml"));
        Ok(Self {
            config_file,
            library_dir: data.join("luna-next/wallpapers"),
            renderer,
        })
    }
}

fn nonempty_env(name: &str) -> Option<std::ffi::OsString> {
    env::var_os(name).filter(|value| !value.is_empty())
}
fn base_dir(name: &str, fallback: &str) -> Result<PathBuf> {
    match nonempty_env(name) {
        Some(path) => Ok(PathBuf::from(path)),
        None => nonempty_env("HOME")
            .map(|home| PathBuf::from(home).join(fallback))
            .ok_or_else(|| Error::Message(format!("{name} or HOME must be set"))),
    }
}
