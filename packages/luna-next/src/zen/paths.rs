use std::{
    env, fs,
    path::{Component, Path, PathBuf},
};

use crate::{Error, Result, io_error};

/// Zen's native profile registry directory; configuration does not create profiles.
#[derive(Clone, Debug)]
pub struct Paths {
    pub profiles_dir: PathBuf,
}

impl Paths {
    /// Follow Zen's native root selection: an existing ~/.zen, otherwise XDG config home.
    pub fn from_env() -> Result<Self> {
        let home = env::var_os("HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .ok_or_else(|| Error::Message("HOME must be set".into()))?;
        let old_root = home.join(".zen");
        let profiles_dir = match fs::symlink_metadata(&old_root) {
            Ok(_) => old_root,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                env::var_os("XDG_CONFIG_HOME")
                    .filter(|value| !value.is_empty())
                    .map(PathBuf::from)
                    .unwrap_or_else(|| home.join(".config"))
                    .join("zen")
            }
            Err(error) => return Err(io_error("inspect Zen profile root", &old_root, error)),
        };
        Ok(Self { profiles_dir })
    }
}

pub(super) fn absolute(path: &Path) -> Result<PathBuf> {
    if path.as_os_str().is_empty() {
        return Err(Error::Message("Zen paths must not be empty".into()));
    }
    let path =
        std::path::absolute(path).map_err(|error| io_error("locate Zen path", path, error))?;
    if path.parent().is_none() {
        return Err(Error::Message(
            "Zen paths cannot be the filesystem root".into(),
        ));
    }
    check(&path)?;
    Ok(path)
}

/// Browser state and declared exports must never resolve through links or special files.
pub(super) fn check(path: &Path) -> Result<()> {
    let mut ancestor = PathBuf::new();
    for component in path.components() {
        if matches!(component, Component::ParentDir) {
            return Err(Error::Message(format!(
                "Zen paths cannot contain '..': {}",
                path.display()
            )));
        }
        ancestor.push(component);
        match fs::symlink_metadata(&ancestor) {
            Ok(metadata)
                if metadata.is_symlink() || (!metadata.is_file() && !metadata.is_dir()) =>
            {
                return Err(Error::Message(format!(
                    "Zen paths must not contain links or special files: {}",
                    ancestor.display()
                )));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(io_error("inspect Zen path", &ancestor, error)),
        }
    }
    Ok(())
}
