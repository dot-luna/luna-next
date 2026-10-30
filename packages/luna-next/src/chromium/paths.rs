use std::{
    env, fs,
    path::{Component, Path, PathBuf},
};

use crate::{Error, Result, io_error};

/// Separate browser data and launch entries; the regular Chromium profile is never exported.
#[derive(Clone, Debug)]
pub struct Paths {
    pub user_data_dir: PathBuf,
    pub launcher: PathBuf,
    pub desktop_file: PathBuf,
}

impl Paths {
    /// Use XDG configuration/data homes and the normal user's local executable directory.
    pub fn from_env() -> Result<Self> {
        let home = env::var_os("HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .ok_or_else(|| Error::Message("HOME must be set".into()))?;
        let base = |key: &str, fallback: &str| {
            env::var_os(key)
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(fallback))
        };
        Ok(Self {
            user_data_dir: base("XDG_CONFIG_HOME", ".config").join("luna-next/chromium"),
            launcher: home.join(".local/bin/luna-chromium"),
            desktop_file: base("XDG_DATA_HOME", ".local/share")
                .join("applications/luna-chromium.desktop"),
        })
    }
}

/// Reject links and special files before accessing browser-owned state or publishing exports.
pub(super) fn check(path: &Path) -> Result<()> {
    let mut ancestor = PathBuf::new();
    for component in path.components() {
        if matches!(component, Component::ParentDir) {
            return Err(Error::Message(format!(
                "Chromium paths cannot contain '..': {}",
                path.display()
            )));
        }
        ancestor.push(component);
        match fs::symlink_metadata(&ancestor) {
            Ok(metadata)
                if metadata.is_symlink() || (!metadata.is_file() && !metadata.is_dir()) =>
            {
                return Err(Error::Message(format!(
                    "Chromium paths must not contain links or special files: {}",
                    ancestor.display()
                )));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(io_error("inspect Chromium path", &ancestor, error)),
        }
    }
    Ok(())
}
