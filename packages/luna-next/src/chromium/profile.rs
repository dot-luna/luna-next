use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
};

use serde::Serialize;
use serde_json::{Value, json};

use super::{Paths, browser, files, launch, paths};
use crate::{Error, Result, config_io, install::replace, io_error};

const OWNER: &[u8] = b"Luna Next Chromium\n";

/// A profile selected by its exact directory, with an optional Luna launch entry.
#[derive(Debug, Serialize)]
pub struct Profile {
    pub directory: PathBuf,
    pub name: String,
    pub launcher: Option<PathBuf>,
}

pub(super) struct Target {
    pub directory: PathBuf,
    pub root: PathBuf,
    pub basename: String,
    pub managed: bool,
}

impl Target {
    pub fn resolve(paths: &Paths, profile: Option<&Path>) -> Result<Self> {
        let directory = match profile {
            Some(path) if path.as_os_str().is_empty() => {
                return Err(Error::Message("Profile path must not be empty".into()));
            }
            Some(path) => std::path::absolute(path)
                .map_err(|error| io_error("locate Chromium profile", path, error))?,
            None => paths.user_data_dir.join("Default"),
        };
        paths::check(&directory)?;
        let basename = directory
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.chars().any(char::is_control))
            .ok_or_else(|| {
                Error::Message(
                    "Profile directory must have a UTF-8 filename without control characters"
                        .into(),
                )
            })?
            .to_owned();
        let root = directory
            .parent()
            .ok_or_else(|| Error::Message("Profile cannot be the filesystem root".into()))?
            .to_owned();
        if directory == paths.launcher
            || directory == paths.desktop_file
            || paths.launcher.starts_with(&directory)
            || paths.desktop_file.starts_with(&directory)
        {
            return Err(Error::Message("Profile overlaps its launch entries".into()));
        }
        Ok(Self {
            directory,
            root,
            basename,
            managed: profile.is_none(),
        })
    }

    pub fn preferences(&self) -> PathBuf {
        self.directory.join("Preferences")
    }

    pub fn idle(&self) -> Result<()> {
        for name in ["SingletonLock", "SingletonSocket", "SingletonCookie"] {
            let path = self.root.join(name);
            match fs::symlink_metadata(&path) {
                Ok(_) => {
                    return Err(Error::Message(format!(
                        "Chromium user-data directory is in use or has a stale {name}; close Chromium before configuring this profile"
                    )));
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(io_error("inspect Chromium singleton lock", &path, error));
                }
            }
        }
        Ok(())
    }

    pub fn exists(&self) -> Result<bool> {
        paths::check(&self.preferences())?;
        let exists = match fs::symlink_metadata(self.preferences()) {
            Ok(metadata) if metadata.is_file() => true,
            Ok(_) => {
                return Err(Error::Message(
                    "Profile Preferences must be a regular file".into(),
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            Err(error) => return Err(io_error("inspect Chromium profile", &self.directory, error)),
        };
        if exists && self.managed {
            let marker = files::File::open(&self.root.join(".luna-managed"))?;
            if marker.original() != Some(OWNER) {
                return Err(Error::Message(
                    "Refusing to adopt an existing unowned Chromium profile".into(),
                ));
            }
        }
        Ok(exists)
    }

    pub fn existing(&self) -> Result<()> {
        self.idle()?;
        if !self.exists()? {
            return Err(Error::Message(format!(
                "Chromium profile does not exist: {}; run luna chromium create-profile or luna chromium setup first",
                self.directory.display()
            )));
        }
        files::File::open(&self.preferences())?.json()?;
        files::File::open(&self.root.join("Local State"))?.json()?;
        Ok(())
    }
}

pub(super) fn create(paths: &Paths, profile: Option<&Path>) -> Result<Profile> {
    let target = Target::resolve(paths, profile)?;
    let (binary, _) = browser::locate()?;
    let _lock = config_io::lock(&target.root)?;
    target.idle()?;
    files::File::open(&target.root.join("Local State"))?.json()?;
    if target.exists()? {
        target.existing()?;
        let values = files::File::open(&target.preferences())?.json()?;
        return Ok(Profile {
            directory: target.directory,
            name: name(&values, &target.basename),
            launcher: target.managed.then(|| paths.launcher.clone()),
        });
    }
    if target.directory.exists() {
        return Err(Error::Message(format!(
            "Refusing to replace an existing profile directory: {}",
            target.directory.display()
        )));
    }
    let display_name = browser::git_name()?;
    let values = json!({"profile": {"name": display_name, "using_default_name": false}});
    let stage = tempfile::tempdir()
        .map_err(|error| io_error("stage Chromium profile", &target.directory, error))?;
    let staged_profile = stage.path().join("profile");
    fs::create_dir(&staged_profile)
        .map_err(|error| io_error("stage Chromium profile", &staged_profile, error))?;
    fs::set_permissions(&staged_profile, fs::Permissions::from_mode(0o700))
        .map_err(|error| io_error("set Chromium profile permissions", &staged_profile, error))?;
    fs::write(
        staged_profile.join("Preferences"),
        serde_json::to_vec_pretty(&values)?,
    )
    .map_err(|error| io_error("write initial Chromium preferences", &staged_profile, error))?;
    fs::set_permissions(
        staged_profile.join("Preferences"),
        fs::Permissions::from_mode(0o600),
    )
    .map_err(|error| {
        io_error(
            "set Chromium preferences permissions",
            &staged_profile,
            error,
        )
    })?;
    let mut launcher = files::File::open(&paths.launcher)?;
    let mut desktop = files::File::open(&paths.desktop_file)?;
    if target.managed {
        launcher.stage(launch::script(&binary, &target.root)?.as_bytes(), 0o755)?;
        desktop.stage(launch::desktop(&paths.launcher)?.as_bytes(), 0o644)?;
    }
    target.idle()?;
    if target.exists()? || target.directory.exists() {
        return Err(Error::Message(
            "Chromium profile appeared externally before creation".into(),
        ));
    }
    if target.managed {
        let owner = files::File::open(&target.root.join(".luna-managed"))?;
        if let Some(bytes) = owner.original() {
            if bytes != OWNER {
                return Err(Error::Message(
                    "Chromium data directory has an unrecognized owner marker".into(),
                ));
            }
            replace(&staged_profile, &target.directory, &staged_profile)?;
        } else {
            match fs::read_dir(&target.root) {
                Ok(mut entries) => {
                    if let Some(entry) = entries.next() {
                        entry.map_err(|error| {
                            io_error("inspect Chromium data entry", &target.root, error)
                        })?;
                        return Err(Error::Message(
                            "Refusing to replace an existing unowned Chromium data directory"
                                .into(),
                        ));
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(io_error(
                        "inspect Chromium data directory",
                        &target.root,
                        error,
                    ));
                }
            }
            let staged_root = stage.path().join("root");
            fs::create_dir(&staged_root)
                .map_err(|error| io_error("stage Chromium data directory", &staged_root, error))?;
            fs::set_permissions(&staged_root, fs::Permissions::from_mode(0o700))
                .map_err(|error| io_error("set Chromium data permissions", &staged_root, error))?;
            fs::rename(&staged_profile, staged_root.join("Default")).map_err(|error| {
                io_error("stage Chromium default profile", &staged_profile, error)
            })?;
            fs::write(staged_root.join(".luna-managed"), OWNER).map_err(|error| {
                io_error("mark Chromium profile ownership", &staged_root, error)
            })?;
            replace(&staged_root, &target.root, &staged_root)?;
        }
        launcher.publish()?;
        desktop.publish()?;
    } else {
        replace(&staged_profile, &target.directory, &staged_profile)?;
    }
    Ok(Profile {
        directory: target.directory,
        name: display_name,
        launcher: target.managed.then(|| paths.launcher.clone()),
    })
}

pub(super) fn name(values: &Value, fallback: &str) -> String {
    values
        .get("profile")
        .and_then(|profile| profile.get("name"))
        .and_then(Value::as_str)
        .unwrap_or(fallback)
        .to_owned()
}
