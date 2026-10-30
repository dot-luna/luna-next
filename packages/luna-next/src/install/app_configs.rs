use std::{
    collections::HashSet,
    env, fs,
    io::{self, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use serde::Deserialize;

pub(super) mod files;

use files::{copy_tree, relative, replace, validate_destinations, validate_source};

use super::{Report, install_via::identifier};
use crate::{Error, Result, io_error};

#[derive(Deserialize)]
struct App {
    package: Option<String>,
    configurator: Option<Configurator>,
    #[serde(default = "config_directory")]
    config: PathBuf,
    #[serde(default)]
    command: Vec<Vec<String>>,
    exports: Vec<Export>,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum Configurator {
    Chromium,
    Zen,
}

#[derive(Deserialize)]
struct Export {
    source: PathBuf,
    target: PathBuf,
    #[serde(default)]
    base: ExportBase,
    directory_env: Option<String>,
    file_env: Option<String>,
    defaults: Option<PathBuf>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "lowercase")]
enum ExportBase {
    #[default]
    Config,
    Home,
}

fn config_directory() -> PathBuf {
    "config".into()
}

fn environment_path(key: Option<&str>) -> Result<Option<PathBuf>> {
    match key {
        Some(key) if key.is_empty() || key.contains(['=', '\0']) => Err(Error::Message(format!(
            "Invalid configuration environment key '{key}'"
        ))),
        Some(key) => Ok(env::var_os(key)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)),
        None => Ok(None),
    }
}

/// Build and replace the selected `apps/<name>/app.conf` exports; empty names select all apps.
/// Existing export contents are discarded without backups, including managed user entries.
/// Builders and source validation finish before publication for each app. Filesystem failures
/// during publication can leave earlier exports installed; this is not an app-wide transaction.
/// Browser configuration applies only to existing profiles. Selecting all apps skips a
/// browser without its default profile. Explicit Chromium selection opens its native
/// installation page; implicit configuration only prepares files. Zen applies on next start.
pub fn install_app_configs(repository: &Path, names: &[String]) -> Result<Report> {
    configure(repository, names, None, None)
}

/// Apply Chromium or Zen settings to an existing explicit profile directory.
/// `names` must select exactly one supported browser. Chromium opens its installation page
/// for extension/theme confirmation; Zen loads its prepared settings on the next start.
pub fn install_app_configs_for_profile(
    repository: &Path,
    names: &[String],
    profile: &Path,
) -> Result<Report> {
    if names.len() != 1 || !matches!(names[0].as_str(), "chromium" | "zen") {
        return Err(Error::Message(
            "--profile requires selecting only the chromium or zen app.".into(),
        ));
    }
    configure(repository, names, None, Some(profile))
}

/// Create a missing Chromium profile and apply the checkout's Chromium app settings.
/// App descriptor and source containment checks complete before profile creation.
pub fn setup_chromium(
    repository: &Path,
    profile: Option<&Path>,
) -> Result<crate::chromium::Configured> {
    let apps = repository.join("apps");
    let root = fs::canonicalize(&apps)
        .map_err(|error| io_error("locate app configurations", &apps, error))?;
    let (app_dir, app) = load_app(&apps.join("chromium"), &root)?;
    if !matches!(app.configurator, Some(Configurator::Chromium)) {
        return Err(Error::Message(
            "The chromium app must declare its native Chromium configurator.".into(),
        ));
    }
    let config = native_source("chromium", &app_dir, &app)?;
    crate::chromium::Chromium::from_env()?.setup(&config, profile)
}

/// Replace configs whose descriptor's `package` matches an installed package name.
/// Descriptors without `package` match their app folder name. Empty and unmatched
/// selections do nothing; publication follows [`install_app_configs`].
pub fn configure_installed_apps(repository: &Path, packages: &[String]) -> Result<Report> {
    if packages.is_empty() {
        return Ok(Report::default());
    }
    configure(repository, &[], Some(packages), None)
}

fn configure(
    repository: &Path,
    names: &[String],
    packages: Option<&[String]>,
    profile: Option<&Path>,
) -> Result<Report> {
    let mut selected = HashSet::new();
    for name in names {
        identifier(name)?;
        if !selected.insert(name.as_str()) {
            return Err(Error::Message(format!("Duplicate app '{name}'")));
        }
    }
    let apps = repository.join("apps");
    let entries = match fs::read_dir(&apps) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound && names.is_empty() => {
            return Ok(Report::default());
        }
        Err(error) => return Err(io_error("read app configurations", &apps, error)),
    };
    let root = fs::canonicalize(&apps)
        .map_err(|error| io_error("locate app configurations", &apps, error))?;
    let mut directories = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| io_error("read app configuration", &apps, error))?;
        if entry.path().join("app.conf").is_file() {
            directories.push(entry.path());
        }
    }
    directories.sort();
    for name in names {
        if !directories
            .iter()
            .any(|path| path.file_name().is_some_and(|file| file == name.as_str()))
        {
            return Err(Error::Message(format!("Unknown app '{name}'")));
        }
    }
    directories.retain(|path| {
        names.is_empty()
            || path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| selected.contains(name))
    });
    let mut selected_apps = Vec::new();
    for path in directories {
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        identifier(&name)?;
        let (app_dir, app) = load_app(&path, &root)?;
        if packages.is_some_and(|packages| {
            !packages
                .iter()
                .any(|package| package == app.package.as_ref().unwrap_or(&name))
        }) {
            continue;
        }
        selected_apps.push((name, app_dir, app));
    }
    if selected_apps.is_empty() {
        return Ok(Report::default());
    }
    if unsafe { libc::geteuid() } == 0 {
        return Err(Error::Message(
            "Run luna as your normal user, without sudo.".into(),
        ));
    }
    let current = env::current_dir()
        .map_err(|error| io_error("locate current directory", Path::new("."), error))?;
    let config_home = env::var_os("XDG_CONFIG_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            env::var_os("HOME")
                .filter(|value| !value.is_empty())
                .map(|home| PathBuf::from(home).join(".config"))
        })
        .ok_or_else(|| Error::Message("HOME or XDG_CONFIG_HOME must be set.".into()))?;
    if !config_home.is_absolute() {
        return Err(Error::Message(
            "The configuration directory must be an absolute path.".into(),
        ));
    }
    let mut report = Report::default();
    for (name, app_dir, app) in selected_apps {
        if profile.is_some()
            && !matches!(
                app.configurator,
                Some(Configurator::Chromium | Configurator::Zen)
            )
        {
            return Err(Error::Message(
                "The selected browser app must declare its native configurator.".into(),
            ));
        }
        relative(&app.config)?;
        if let Some(configurator) = &app.configurator {
            match configurator {
                Configurator::Chromium => {
                    let chromium = crate::chromium::Chromium::from_env()?;
                    if names.is_empty()
                        && profile.is_none()
                        && !chromium.default_profile_exists()?
                    {
                        report
                            .skipped
                            .push(format!("{name} (run luna chromium setup)"));
                        continue;
                    }
                    let config = native_source(&name, &app_dir, &app)?;
                    let configured = chromium.configure_profile(&config, profile)?;
                    if !names.is_empty() {
                        chromium.open_installation(&configured)?;
                    }
                }
                Configurator::Zen => {
                    let zen = crate::zen::Zen::from_env()?;
                    if names.is_empty() && profile.is_none() && !zen.default_profile_exists()? {
                        report
                            .skipped
                            .push("zen (open Zen once, then run luna conf zen)".into());
                        continue;
                    }
                    let config = native_source(&name, &app_dir, &app)?;
                    zen.configure_profile(&config, profile)?;
                }
            }
            report.installed.push(name);
            continue;
        }
        if app.command.iter().any(|command| {
            command
                .first()
                .is_none_or(|program| program.trim().is_empty())
                || command.iter().any(|argument| argument.contains('\0'))
        }) {
            return Err(Error::Message(format!(
                "Invalid configuration command for '{name}'"
            )));
        }
        let mut targets = Vec::new();
        let mut seen = HashSet::new();
        for export in &app.exports {
            if export.source != Path::new(".") {
                relative(&export.source)?;
            }
            relative(&export.target)?;
            let directory = environment_path(export.directory_env.as_deref())?;
            let file = environment_path(export.file_env.as_deref())?;
            let target = if let Some(path) = file {
                current.join(path)
            } else {
                let directory = match directory {
                    Some(path) => current.join(path),
                    None => match export.base {
                        ExportBase::Config => config_home.clone(),
                        ExportBase::Home => {
                            let home = env::var_os("HOME")
                                .filter(|value| !value.is_empty())
                                .map(PathBuf::from)
                                .ok_or_else(|| Error::Message("HOME must be set.".into()))?;
                            if !home.is_absolute() {
                                return Err(Error::Message(
                                    "HOME must be an absolute path.".into(),
                                ));
                            }
                            home
                        }
                    },
                };
                directory.join(&export.target)
            };
            if !seen.insert(target.clone()) {
                return Err(Error::Message(format!(
                    "Duplicate configuration target: {}",
                    target.display()
                )));
            }
            let defaults = export
                .defaults
                .as_ref()
                .map(|path| -> Result<PathBuf> {
                    relative(path)?;
                    Ok(config_home.join(path))
                })
                .transpose()?;
            targets.push((target, defaults));
        }
        validate_destinations(&targets, repository, &root)?;
        let stage = tempfile::tempdir()
            .map_err(|error| io_error("stage app configuration", &app_dir, error))?;
        let source = app_dir.join(&app.config);
        match fs::canonicalize(&source) {
            Ok(source) if source.starts_with(&app_dir) && source.is_dir() => {
                copy_tree(&source, stage.path(), &source)?;
            }
            Ok(_) => {
                return Err(Error::Message(format!(
                    "Invalid configuration directory: {}",
                    source.display()
                )));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound && !app.command.is_empty() => {}
            Err(error) => return Err(io_error("read app configuration source", &source, error)),
        }
        for arguments in &app.command {
            let status = Command::new(&arguments[0])
                .args(&arguments[1..])
                .current_dir(&app_dir)
                .env("LUNA_CONFIG_OUTPUT", stage.path())
                .env("LUNA_APP_DIR", &app_dir)
                .stdin(Stdio::inherit())
                .stdout(Stdio::from(io::stderr()))
                .stderr(Stdio::inherit())
                .status()
                .map_err(|error| {
                    Error::Message(format!("Cannot build configuration for '{name}': {error}"))
                })?;
            if !status.success() {
                return Err(Error::Message(format!(
                    "Configuration command failed for '{name}' ({status})"
                )));
            }
        }
        // Inspect every generated export before replacing any destination for this app.
        // Builders can create links or special files that were absent from the input tree.
        let mut sources = Vec::new();
        for (export, (_, defaults)) in app.exports.iter().zip(&targets) {
            let path = stage.path().join(&export.source);
            let source = validate_source(&path, stage.path())?;
            if defaults.is_some() && source.is_dir() {
                return Err(Error::Message(format!(
                    "Configuration defaults require a file export: {}",
                    path.display()
                )));
            }
            sources.push(source);
        }
        for (source, (target, defaults)) in sources.iter().zip(&targets) {
            if let Some(defaults) = defaults {
                let path = defaults.to_str().ok_or_else(|| {
                    Error::Message(format!(
                        "Configuration defaults path must be valid UTF-8: {}",
                        defaults.display()
                    ))
                })?;
                let include = format!(
                    "include required(file({}))\n",
                    serde_json::to_string(path).map_err(|error| {
                        Error::Message(format!("Cannot quote configuration defaults: {error}"))
                    })?
                );
                // Publish defaults first so a newly installed include can resolve immediately.
                replace(source, defaults, stage.path())?;
                let mut entry = tempfile::NamedTempFile::new_in(stage.path())
                    .map_err(|error| io_error("stage user configuration", target, error))?;
                entry
                    .write_all(include.as_bytes())
                    .map_err(|error| io_error("stage user configuration", target, error))?;
                replace(entry.path(), target, stage.path())?;
            } else {
                replace(source, target, stage.path())?;
            }
        }
        if sources.is_empty() {
            report.skipped.push(name);
        } else {
            report.installed.push(name);
        }
    }
    Ok(report)
}

fn load_app(path: &Path, root: &Path) -> Result<(PathBuf, App)> {
    let app_dir =
        fs::canonicalize(path).map_err(|error| io_error("locate app directory", path, error))?;
    if !app_dir.starts_with(root) {
        return Err(Error::Message(format!(
            "App directory escapes apps/: {}",
            path.display()
        )));
    }
    let descriptor = path.join("app.conf");
    let app: App =
        serde_json::from_value(luna_next_hocon::load(&descriptor)?).map_err(|error| {
            Error::Message(format!("Invalid app '{}': {error}", descriptor.display()))
        })?;
    if let Some(package) = &app.package {
        identifier(package)?;
    }
    Ok((app_dir, app))
}

fn native_source(name: &str, app_dir: &Path, app: &App) -> Result<PathBuf> {
    if !app.command.is_empty() || !app.exports.is_empty() {
        return Err(Error::Message(format!(
            "Native configurator '{name}' cannot also declare commands or exports"
        )));
    }
    relative(&app.config)?;
    validate_source(&app_dir.join(&app.config), app_dir)
}
