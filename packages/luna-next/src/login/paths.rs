use crate::{Error, Result, io_error};
use std::{
    env, fs,
    path::{Component, Path, PathBuf},
};

/// User configuration, screen library, and the installed greeter application.
#[derive(Clone, Debug)]
pub struct Paths {
    pub config_file: PathBuf,
    pub screens_dir: PathBuf,
    pub app_dir: PathBuf,
}

impl Paths {
    /// Use XDG homes, with the checkout greeter as a development fallback.
    /// `LUNA_LOGIN_CONFIG` overrides the complete configuration filename.
    pub fn from_env() -> Result<Self> {
        let data = base("XDG_DATA_HOME", ".local/share")?.join("luna-next/login");
        let app_dir = if data.join("app/greeter/Main.qml").is_file() {
            data.join("app")
        } else {
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../src/luna-login/src")
        };
        let config_file = match env::var_os("LUNA_LOGIN_CONFIG").filter(|value| !value.is_empty()) {
            Some(path) => PathBuf::from(path),
            None => base("XDG_CONFIG_HOME", ".config")?.join("luna-next/login.conf"),
        };
        Ok(Self {
            config_file,
            screens_dir: data.join("screens"),
            app_dir,
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

/// Resolve existing ancestors too, so symlinked parents cannot hide overlapping writes.
pub(super) fn identity(path: &Path) -> Result<PathBuf> {
    let absolute = std::path::absolute(path).map_err(|error| io_error("locate", path, error))?;
    let mut ancestor = absolute.as_path();
    let mut suffix: Vec<Component<'_>> = Vec::new();
    loop {
        match fs::canonicalize(ancestor) {
            Ok(mut result) => {
                for component in suffix.into_iter().rev() {
                    if component == Component::ParentDir {
                        result.pop();
                    } else {
                        result.push(component.as_os_str());
                    }
                }
                return Ok(result);
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if fs::symlink_metadata(ancestor).is_ok() {
                    return Err(io_error("locate", path, error));
                }
                let Some(parent) = ancestor.parent() else {
                    return Err(io_error("locate", path, error));
                };
                suffix.push(ancestor.components().next_back().expect("non-root path"));
                ancestor = parent;
            }
            Err(error) => return Err(io_error("locate", path, error)),
        }
    }
}

pub(super) fn overlaps(left: &Path, right: &Path) -> bool {
    left.starts_with(right) || right.starts_with(left)
}
