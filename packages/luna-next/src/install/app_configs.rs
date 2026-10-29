use std::{
    collections::HashSet,
    env, fs,
    io::{self, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use serde::Deserialize;

mod files;

use files::{copy_tree, relative, replace, validate_destinations, validate_source};

use super::{Report, install_via::identifier};
use crate::{Error, Result, io_error};

#[derive(Deserialize)]
struct App {
    package: Option<String>,
    #[serde(default = "config_directory")]
    config: PathBuf,
    #[serde(default)]
    command: Vec<Vec<String>>,
    exports: Vec<Export>,
}

#[derive(Deserialize)]
struct Export {
    source: PathBuf,
    target: PathBuf,
    file_env: Option<String>,
    defaults: Option<PathBuf>,
}

fn config_directory() -> PathBuf {
    "config".into()
}

/// Build and replace the selected `apps/<name>/app.conf` exports; empty names select all apps.
/// Existing export contents are discarded without backups, including managed user entries.
/// Builders and source validation finish before publication for each app. Filesystem failures
/// during publication can leave earlier exports installed; this is not an app-wide transaction.
pub fn install_app_configs(repository: &Path, names: &[String]) -> Result<Report> {
    configure(repository, names, None)
}

/// Replace configs whose descriptor's `package` matches an installed package name.
/// Descriptors without `package` match their app folder name. Empty and unmatched
/// selections do nothing; publication follows [`install_app_configs`].
pub fn configure_installed_apps(repository: &Path, packages: &[String]) -> Result<Report> {
    if packages.is_empty() {
        return Ok(Report::default());
    }
    configure(repository, &[], Some(packages))
}

fn configure(repository: &Path, names: &[String], packages: Option<&[String]>) -> Result<Report> {
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
        let app_dir = fs::canonicalize(&path)
            .map_err(|error| io_error("locate app directory", &path, error))?;
        if !app_dir.starts_with(&root) {
            return Err(Error::Message(format!(
                "App directory escapes apps/: {name}"
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
            "Run lnxt as your normal user, without sudo.".into(),
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
        relative(&app.config)?;
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
            let override_path = match &export.file_env {
                Some(key) if key.is_empty() || key.contains(['=', '\0']) => {
                    return Err(Error::Message(format!(
                        "Invalid configuration environment key '{key}'"
                    )));
                }
                Some(key) => env::var_os(key)
                    .filter(|value| !value.is_empty())
                    .map(PathBuf::from),
                None => None,
            };
            let target = override_path.map_or_else(
                || config_home.join(&export.target),
                |path| current.join(path),
            );
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
