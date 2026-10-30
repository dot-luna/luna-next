//! Desktop launchers for web apps using Luna's existing Chromium profiles.

mod desktop;
mod icon;

use std::{
    env, fs,
    os::unix::fs::PermissionsExt,
    path::{Component, Path, PathBuf},
};

use serde::Serialize;

use crate::{Error, Result, chromium, config_io, install, io_error};

/// Separate exported desktop entries and app assets, launched through an installed Luna binary.
#[derive(Debug, Clone)]
pub struct Paths {
    pub applications_dir: PathBuf,
    pub data_dir: PathBuf,
    pub launcher: PathBuf,
}

/// A published desktop entry and its selected existing Chromium profile.
#[derive(Debug, Serialize)]
pub struct Installed {
    pub name: String,
    pub url: String,
    pub profile: PathBuf,
    pub desktop_file: PathBuf,
    pub icon: PathBuf,
}

/// Install desktop launchers and their icons without changing browser-owned state.
pub struct Webapps {
    paths: Paths,
}

impl Webapps {
    /// Select XDG data paths and the caller's installed Luna executable without writing files.
    pub fn from_env(launcher: &Path) -> Result<Self> {
        let home = env::var_os("HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .ok_or_else(|| Error::Message("HOME must be set".into()))?;
        let data = env::var_os("XDG_DATA_HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".local/share"));
        Self::new(Paths {
            applications_dir: data.join("applications"),
            data_dir: data.join("luna-next/webapps"),
            launcher: launcher.to_owned(),
        })
    }

    /// Use explicit export paths. Links, overlapping exports, invalid desktop paths,
    /// and missing/non-executable launchers are rejected before any download or publication.
    pub fn new(mut paths: Paths) -> Result<Self> {
        for path in [
            &mut paths.applications_dir,
            &mut paths.data_dir,
            &mut paths.launcher,
        ] {
            if path.as_os_str().is_empty() {
                return Err(Error::Message("Web app paths must not be empty".into()));
            }
            *path = std::path::absolute(&*path)
                .map_err(|error| io_error("locate web app path", path, error))?;
            if path.parent().is_none() {
                return Err(Error::Message(
                    "Web app paths cannot be the filesystem root".into(),
                ));
            }
            desktop::text(path)?;
            check(path)?;
        }
        let destinations = [&paths.applications_dir, &paths.data_dir, &paths.launcher];
        for (index, left) in destinations.iter().enumerate() {
            if destinations[index + 1..]
                .iter()
                .any(|right| left.starts_with(right) || right.starts_with(left))
            {
                return Err(Error::Message("Web app paths must not overlap".into()));
            }
        }
        if desktop::text(&paths.launcher)?.contains('=') {
            // `env --` still consumes NAME=VALUE arguments before choosing a command.
            return Err(Error::Message(
                "Luna launcher paths must not contain '='; env treats them as assignments".into(),
            ));
        }
        executable(&paths.launcher)?;
        Ok(Self { paths })
    }

    /// Install a named HTTP(S) app using an existing Chromium profile and a downloaded icon.
    /// Omission selects Luna's default profile; an override is retained in the desktop entry.
    /// Name identity is exact after trimming, so distinct names never overwrite one another.
    /// Validation and download failures preserve installed exports. Each export publishes
    /// atomically, assets before the desktop entry; late filesystem failures may be partial.
    /// This never creates/configures profiles or opens a browser window.
    pub fn install(
        &self,
        name: &str,
        url: &str,
        profile: Option<&Path>,
        icon_url: Option<&str>,
    ) -> Result<Installed> {
        let name = validated_name(name)?;
        let url = chromium::app_url(url)?;
        let selected = chromium::Chromium::from_env()?.app_profile(profile)?;
        let id = app_id(name);
        let assets = self.paths.data_dir.join(&id);
        let desktop_file = self.paths.applications_dir.join(format!("{id}.desktop"));
        self.preflight(&selected.directory, &assets, &desktop_file)?;
        let stage =
            tempfile::tempdir().map_err(|error| io_error("stage web app", &assets, error))?;
        let staged_assets = stage.path().join("assets");
        fs::create_dir(&staged_assets)
            .map_err(|error| io_error("stage web app assets", &staged_assets, error))?;
        let staged_icon = icon::prepare(&url, icon_url, &staged_assets)?;
        check(&staged_icon)?;
        if staged_icon.parent() != Some(staged_assets.as_path()) || !staged_icon.is_file() {
            return Err(Error::Message("Invalid staged web app icon".into()));
        }
        let icon = assets.join(staged_icon.file_name().unwrap());
        let entry = desktop::entry(
            name,
            url.as_str(),
            &self.paths.launcher,
            profile.map(|_| selected.directory.as_path()),
            &icon,
        )?;
        let staged_desktop = stage.path().join("entry.desktop");
        fs::write(&staged_desktop, entry)
            .map_err(|error| io_error("stage web app desktop entry", &staged_desktop, error))?;
        fs::set_permissions(&staged_desktop, fs::Permissions::from_mode(0o644))
            .map_err(|error| io_error("set desktop entry permissions", &staged_desktop, error))?;

        self.preflight(&selected.directory, &assets, &desktop_file)?;
        let lock_path = desktop_file.with_file_name(format!(".{id}.desktop.lock"));
        check(&lock_path)?;
        let _lock = config_io::lock(&desktop_file)?;
        self.preflight(&selected.directory, &assets, &desktop_file)?;
        install::replace(&staged_assets, &assets, &staged_assets)?;
        check(&desktop_file)?;
        install::replace(&staged_desktop, &desktop_file, &staged_desktop)?;
        Ok(Installed {
            name: name.to_owned(),
            url: url.to_string(),
            profile: selected.directory,
            desktop_file,
            icon,
        })
    }

    fn preflight(&self, profile: &Path, assets: &Path, desktop_file: &Path) -> Result<()> {
        desktop::text(profile)?;
        executable(&self.paths.launcher)?;
        for path in [
            &self.paths.applications_dir,
            &self.paths.data_dir,
            &self.paths.launcher,
            assets,
            desktop_file,
        ] {
            check(path)?;
            let root = profile.parent().expect("validated Chromium profile");
            if path.starts_with(root) || root.starts_with(path) {
                return Err(Error::Message(
                    "Web app exports must not overlap Chromium browser data".into(),
                ));
            }
        }
        for path in [&self.paths.applications_dir, &self.paths.data_dir] {
            if fs::symlink_metadata(path).is_ok_and(|metadata| !metadata.is_dir()) {
                return Err(Error::Message(format!(
                    "Web app export parent must be a directory: {}",
                    path.display()
                )));
            }
        }
        Ok(())
    }
}

pub(crate) fn validated_name(value: &str) -> Result<&str> {
    let name = value.trim();
    if name.is_empty() || name.len() > 100 || name.chars().any(char::is_control) {
        return Err(Error::Message(
            "Web app name must contain 1–100 UTF-8 bytes without control characters".into(),
        ));
    }
    Ok(name)
}

// Hex encoding is injective over the bounded UTF-8 name, avoiding collisions between
// names such as "YouTube Music" and "YouTube-Music" without a process-dependent hash.
fn app_id(name: &str) -> String {
    let mut id = String::from("luna-webapp-");
    for byte in name.bytes() {
        use std::fmt::Write;
        write!(id, "{byte:02x}").unwrap();
    }
    id
}

fn executable(path: &Path) -> Result<()> {
    let metadata =
        fs::metadata(path).map_err(|error| io_error("inspect Luna executable", path, error))?;
    if !metadata.is_file() || metadata.permissions().mode() & 0o111 == 0 {
        return Err(Error::Message(format!(
            "Luna launcher must be an executable file: {}",
            path.display()
        )));
    }
    Ok(())
}

fn check(path: &Path) -> Result<()> {
    let mut ancestor = PathBuf::new();
    for component in path.components() {
        if matches!(component, Component::ParentDir) {
            return Err(Error::Message(format!(
                "Web app paths cannot contain '..': {}",
                path.display()
            )));
        }
        ancestor.push(component);
        match fs::symlink_metadata(&ancestor) {
            Ok(metadata)
                if metadata.is_symlink() || (!metadata.is_dir() && !metadata.is_file()) =>
            {
                return Err(Error::Message(format!(
                    "Web app paths must not contain links or special files: {}",
                    ancestor.display()
                )));
            }
            Ok(metadata) if metadata.is_file() && ancestor != path => {
                return Err(Error::Message(format!(
                    "Web app path parent must be a directory: {}",
                    ancestor.display()
                )));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(io_error("inspect web app path", &ancestor, error)),
        }
    }
    Ok(())
}
