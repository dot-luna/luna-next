//! Native Zen profile configuration, without changing browser registry or user data.

mod appearance;
mod extensions;
mod files;
mod paths;
mod profile;

pub use paths::Paths;

use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{Error, Result, io_error, process, theme::Themes};

/// The exact existing profile and signed-extension declarations configured by Luna.
#[derive(Debug, Serialize)]
pub struct Configured {
    pub profile: PathBuf,
    pub extensions: Vec<String>,
}

/// Apply app-owned settings to one existing Zen profile.
pub struct Zen {
    paths: Paths,
}

#[derive(Deserialize)]
struct Settings {
    extensions: Vec<extensions::Extension>,
}

impl Zen {
    /// Follow Zen's native registry location without creating browser profiles.
    pub fn from_env() -> Result<Self> {
        Self::new(Paths::from_env()?)
    }

    /// Use a specific native registry directory. Empty, linked, or special paths are rejected.
    pub fn new(mut paths: Paths) -> Result<Self> {
        paths.profiles_dir = paths::absolute(&paths.profiles_dir)?;
        Ok(Self { paths })
    }

    /// Inspect the native registry; an absent registry or selected profile returns false.
    /// Ambiguous or malformed registries return errors rather than selecting another profile.
    pub fn default_profile_exists(&self) -> Result<bool> {
        let Some(target) = profile::Target::resolve(&self.paths, None)? else {
            return Ok(false);
        };
        paths::check(&target.directory)?;
        let preferences = files::File::open(&target.directory.join("prefs.js"))?;
        Ok(target.directory.is_dir() && preferences.bytes().is_some())
    }

    /// Replace only user.js, Luna CSS exports, and declared extension XPIs in an existing profile.
    /// Omission selects the native default. Zen must be closed; its POSIX profile lock is held
    /// throughout preparation and publication. Browser data, other extensions, and profiles.ini
    /// remain untouched. Downloads finish and original sources are rechecked before publication;
    /// each export publishes atomically, but a late filesystem failure can leave partial results.
    pub fn configure_profile(
        &self,
        config_dir: &Path,
        directory: Option<&Path>,
    ) -> Result<Configured> {
        if unsafe { libc::geteuid() } == 0 {
            return Err(Error::Message(
                "Run luna as your normal user, without sudo.".into(),
            ));
        }
        let settings = settings(config_dir)?;
        let target = profile::Target::resolve(&self.paths, directory)?
            .ok_or_else(|| profile::missing(&self.paths.profiles_dir))?;
        let preferences = target.preferences()?;
        let source = fs::canonicalize(config_dir)
            .map_err(|error| io_error("locate Zen app settings", config_dir, error))?;
        if target.directory.starts_with(&source) || source.starts_with(&target.directory) {
            return Err(Error::Message("Zen profile overlaps app settings".into()));
        }
        extensions::validate(&settings.extensions)?;
        let mut exports = vec![
            (
                files::File::open(&target.directory.join("user.js"))?,
                Vec::new(),
            ),
            (
                files::File::open(&target.directory.join("chrome/userChrome.css"))?,
                Vec::new(),
            ),
            (
                files::File::open(&target.directory.join("chrome/userContent.css"))?,
                Vec::new(),
            ),
        ];
        for extension in &settings.extensions {
            exports.push((
                files::File::open(
                    &target
                        .directory
                        .join("extensions")
                        .join(format!("{}.xpi", extension.id)),
                )?,
                Vec::new(),
            ));
        }
        let _lock = target.lock()?;
        preferences.check()?;
        target.check_registry()?;
        provider()?;
        let theme = Themes::from_env()?.get(None)?;
        let rendered = appearance::render(config_dir, &theme)?;
        exports[0].1 = rendered.user_js.into_bytes();
        exports[1].1 = rendered.user_chrome.into_bytes();
        exports[2].1 = rendered.user_content.into_bytes();
        let stage = tempfile::tempdir()
            .map_err(|error| io_error("stage Zen configuration", config_dir, error))?;
        let prepared = extensions::prepare(&settings.extensions, stage.path())?;
        for ((_, bytes), extension) in exports.iter_mut().skip(3).zip(&prepared) {
            *bytes = fs::read(&extension.path)
                .map_err(|error| io_error("read prepared Zen extension", &extension.path, error))?;
        }
        preferences.check()?;
        target.check_registry()?;
        for (file, _) in &exports {
            file.check()?;
        }
        for (file, bytes) in exports {
            file.publish(&bytes)?;
        }
        Ok(Configured {
            profile: target.directory,
            extensions: prepared.into_iter().map(|extension| extension.id).collect(),
        })
    }
}

fn settings(config_dir: &Path) -> Result<Settings> {
    let path = config_dir.join("settings.conf");
    if !path.is_file() {
        return Err(Error::Message(format!(
            "Missing Zen settings: {}",
            path.display()
        )));
    }
    let value = luna_next_hocon::load(&path)?;
    let schema_path = config_dir.join("settings.schema.json");
    let schema: Value = serde_json::from_slice(
        &fs::read(&schema_path)
            .map_err(|error| io_error("read Zen settings schema", &schema_path, error))?,
    )?;
    luna_next_hocon::validate_value(&value, &schema)?;
    Ok(serde_json::from_value(value)?)
}

fn provider() -> Result<()> {
    let installed = process::run(
        Command::new("pacman").args(["-Q", "zen-browser-bin"]),
        Duration::from_secs(10),
    )?;
    if !installed.status.success() {
        return Err(Error::Message(
            "Install Zen first: luna install zen-browser-bin".into(),
        ));
    }
    let version = process::run(
        Command::new("zen-browser").arg("--version"),
        Duration::from_secs(10),
    )?;
    process::checked("read Zen version", version)
}
