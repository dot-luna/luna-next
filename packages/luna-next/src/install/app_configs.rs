use std::{
    collections::HashSet,
    env, fs,
    io::{self, Write},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
};

use serde::Deserialize;

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

pub fn install_app_configs(repository: &Path, names: &[String]) -> Result<Report> {
    configure(repository, names, None)
}

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
            relative(&export.source)?;
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
        let managed = targets.iter().any(|(_, defaults)| defaults.is_some());
        if managed {
            validate_destinations(&targets, repository, &root)?;
        }
        if targets
            .iter()
            .map(|(target, _)| missing(target))
            .collect::<Result<Vec<_>>>()?
            .iter()
            .all(|missing| !missing)
            && !managed
        {
            report.skipped.push(name);
            continue;
        }
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
        let mut sources = Vec::new();
        for export in &app.exports {
            let path = stage.path().join(&export.source);
            let source = fs::canonicalize(&path)
                .map_err(|error| io_error("locate generated configuration", &path, error))?;
            if !source.starts_with(stage.path()) || !source.is_file() {
                return Err(Error::Message(format!(
                    "Configuration export must be a file inside staging: {}",
                    path.display()
                )));
            }
            sources.push(source);
        }
        let mut installed = false;
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
                replace_defaults(source, defaults)?;
                let mut entry = tempfile::NamedTempFile::new_in(stage.path())
                    .map_err(|error| io_error("stage user configuration", target, error))?;
                entry
                    .write_all(include.as_bytes())
                    .map_err(|error| io_error("stage user configuration", target, error))?;
                publish(entry.path(), target)?;
                installed = true;
            } else {
                installed |= publish(source, target)?;
            }
        }
        if installed {
            report.installed.push(name);
        } else {
            report.skipped.push(name);
        }
    }
    Ok(report)
}

fn relative(path: &Path) -> Result<()> {
    if path.as_os_str().is_empty()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(Error::Message(format!(
            "App configuration paths must be relative without '..': {}",
            path.display()
        )));
    }
    Ok(())
}

fn validate_destinations(
    targets: &[(PathBuf, Option<PathBuf>)],
    repository: &Path,
    apps: &Path,
) -> Result<()> {
    let repository = fs::canonicalize(repository)
        .map_err(|error| io_error("locate configuration repository", repository, error))?;
    let mut destinations = Vec::new();
    for (target, defaults) in targets {
        for path in std::iter::once(target).chain(defaults.iter()) {
            let destination = destination_identity(path)?;
            if destination.starts_with(&repository)
                || repository.starts_with(&destination)
                || destination.starts_with(apps)
                || apps.starts_with(&destination)
            {
                return Err(Error::Message(format!(
                    "Configuration destination overlaps its source tree: {}",
                    path.display()
                )));
            }
            if destinations.iter().any(|previous: &PathBuf| {
                destination.starts_with(previous) || previous.starts_with(&destination)
            }) {
                return Err(Error::Message(format!(
                    "Configuration destinations overlap: {}",
                    path.display()
                )));
            }
            destinations.push(destination);
        }
        if let Some(defaults) = defaults {
            check_defaults(defaults)?;
            if defaults.to_str().is_none() {
                return Err(Error::Message(format!(
                    "Configuration defaults path must be valid UTF-8: {}",
                    defaults.display()
                )));
            }
        }
    }
    Ok(())
}

fn destination_identity(path: &Path) -> Result<PathBuf> {
    let mut ancestor = path;
    let mut suffix: Vec<Component<'_>> = Vec::new();
    loop {
        match fs::canonicalize(ancestor) {
            Ok(mut resolved) => {
                for component in suffix.into_iter().rev() {
                    if component == Component::ParentDir {
                        resolved.pop();
                    } else {
                        resolved.push(component.as_os_str());
                    }
                }
                return Ok(resolved);
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                if let (Some(component), Some(parent)) =
                    (ancestor.components().next_back(), ancestor.parent())
                {
                    suffix.push(component);
                    ancestor = parent;
                } else {
                    return Err(io_error("locate configuration destination", path, error));
                }
            }
            Err(error) => return Err(io_error("locate configuration destination", path, error)),
        }
    }
}

fn check_defaults(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() => Ok(()),
        Ok(_) => Err(Error::Message(format!(
            "Configuration defaults destination must be a regular file: {}",
            path.display()
        ))),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_error("inspect configuration defaults", path, error)),
    }
}

fn replace_defaults(source: &Path, target: &Path) -> Result<()> {
    check_defaults(target)?;
    let parent = target.parent().unwrap();
    fs::create_dir_all(parent)
        .map_err(|error| io_error("create defaults directory", parent, error))?;
    let temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| io_error("stage configuration defaults", target, error))?;
    fs::copy(source, temporary.path())
        .map_err(|error| io_error("copy configuration defaults", target, error))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| io_error("flush configuration defaults", target, error))?;
    check_defaults(target)?;
    temporary
        .persist(target)
        .map_err(|error| io_error("install configuration defaults", target, error.error))?;
    fs::File::open(parent)
        .and_then(|file| file.sync_all())
        .map_err(|error| io_error("flush configuration defaults directory", parent, error))?;
    Ok(())
}

fn copy_tree(source: &Path, destination: &Path, root: &Path) -> Result<()> {
    for entry in fs::read_dir(source)
        .map_err(|error| io_error("read app configuration source", source, error))?
    {
        let entry =
            entry.map_err(|error| io_error("read app configuration source", source, error))?;
        let path = entry.path();
        let target = destination.join(entry.file_name());
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| io_error("inspect app configuration source", &path, error))?;
        if metadata.is_dir() {
            fs::create_dir(&target)
                .map_err(|error| io_error("stage app configuration directory", &target, error))?;
            copy_tree(&path, &target, root)?;
        } else {
            let resolved = fs::canonicalize(&path)
                .map_err(|error| io_error("locate app configuration source", &path, error))?;
            if !resolved.starts_with(root) || !resolved.is_file() {
                return Err(Error::Message(format!(
                    "App configuration source must be a file inside its config tree: {}",
                    path.display()
                )));
            }
            fs::copy(&resolved, &target)
                .map_err(|error| io_error("stage app configuration file", &path, error))?;
        }
    }
    Ok(())
}

fn missing(path: &Path) -> Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() || metadata.is_symlink() => Ok(false),
        Ok(_) => Err(Error::Message(format!(
            "Configuration destination is not a file: {}",
            path.display()
        ))),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(true),
        Err(error) => Err(io_error("inspect configuration destination", path, error)),
    }
}

fn publish(source: &Path, target: &Path) -> Result<bool> {
    if !missing(target)? {
        return Ok(false);
    }
    let parent = target.parent().unwrap();
    fs::create_dir_all(parent)
        .map_err(|error| io_error("create configuration directory", parent, error))?;
    let temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| io_error("stage configuration export", target, error))?;
    fs::copy(source, temporary.path())
        .map_err(|error| io_error("copy configuration export", target, error))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| io_error("flush configuration export", target, error))?;
    match temporary.persist_noclobber(target) {
        Ok(_) => Ok(true),
        Err(error) if error.error.kind() == io::ErrorKind::AlreadyExists => {
            missing(target).map(|_| false)
        }
        Err(error) => Err(io_error(
            "install configuration export",
            target,
            error.error,
        )),
    }
}
