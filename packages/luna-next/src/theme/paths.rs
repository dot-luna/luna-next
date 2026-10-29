use std::{env, path::PathBuf};

use crate::{Error, Result};

/// Application-selected paths, made absolute by [`super::Themes::new`].
#[derive(Clone, Debug)]
pub struct Paths {
    pub config_file: PathBuf,
    pub library_dir: PathBuf,
    pub wallpaper_dir: PathBuf,
}

impl Paths {
    /// Use XDG config/data homes, falling back to `~/.config` and `~/.local/share`.
    pub fn from_env() -> Result<Self> {
        let data = base("XDG_DATA_HOME", ".local/share")?;
        Ok(Self {
            config_file: base("XDG_CONFIG_HOME", ".config")?.join("luna-next/theme.conf"),
            library_dir: data.join("luna-next/themes"),
            wallpaper_dir: data.join("luna-next/wallpapers"),
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
