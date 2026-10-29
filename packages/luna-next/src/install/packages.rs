use std::{
    collections::HashSet,
    env, fs,
    path::{Path, PathBuf},
};

use serde_json::Value;

use super::{Package, Report, Source, install, install_via::identifier};
use crate::{Error, Result, io_error};

/// Locate package lists via an explicit path, `LUNA_NEXT_ROOT`, the working directory's
/// ancestors, `~/.local/src/luna-next`, then this build's checkout. An explicit or
/// environment-selected path must be valid; it does not fall through to another checkout.
pub fn find_repository(explicit: Option<&Path>) -> Result<PathBuf> {
    let configured = env::var_os("LUNA_NEXT_ROOT").map(PathBuf::from);
    if let Some(path) = explicit.or(configured.as_deref()) {
        let repository = fs::canonicalize(path)
            .map_err(|error| io_error("locate Luna Next checkout", path, error))?;
        if repository.join("installs/packages.conf").is_file() {
            return Ok(repository);
        }
        return Err(Error::Message(format!(
            "No installs/packages.conf in {}",
            repository.display()
        )));
    }
    let current = env::current_dir()
        .map_err(|error| io_error("locate current directory", Path::new("."), error))?;
    for directory in current.ancestors() {
        if directory.join("installs/packages.conf").is_file() {
            return Ok(directory.to_owned());
        }
    }
    if let Some(home) = env::var_os("HOME") {
        let repository = PathBuf::from(home).join(".local/src/luna-next");
        if repository.join("installs/packages.conf").is_file() {
            return fs::canonicalize(&repository)
                .map_err(|error| io_error("locate Luna Next checkout", &repository, error));
        }
    }
    // Keep installed development builds usable outside the checkout.
    let repository = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    if repository.join("installs/packages.conf").is_file() {
        return fs::canonicalize(&repository)
            .map_err(|error| io_error("locate Luna Next checkout", &repository, error));
    }
    Err(Error::Message(
        "Cannot find package lists; run inside the Luna Next checkout or use --repo PATH.".into(),
    ))
}

/// Read and select package recipes without running installers.
/// Empty groups select all lists allowed by `source`; empty names select all matches.
/// Unlisted names are accepted only for an explicit pacman/AUR source without groups.
/// Local relative URLs resolve against `repository`, independently of the working directory.
pub fn get_packages(
    repository: &Path,
    groups: &[&str],
    source: Option<Source>,
    names: &[String],
) -> Result<Vec<Package>> {
    if groups
        .iter()
        .any(|group| !matches!(*group, "core" | "main"))
    {
        return Err(Error::Message(
            "Unknown package group; use core or main.".into(),
        ));
    }
    if !groups.is_empty()
        && source.is_some_and(|source| !matches!(source, Source::Pacman | Source::Aur))
    {
        return Err(Error::Message(
            "Core and main groups support only pacman and AUR sources.".into(),
        ));
    }
    let repository = fs::canonicalize(repository)
        .map_err(|error| io_error("locate package checkout", repository, error))?;
    let directory = repository.join("installs");
    let mut packages = Vec::new();
    if !groups.is_empty()
        || source.is_none_or(|source| matches!(source, Source::Pacman | Source::Aur))
    {
        let path = directory.join("packages.conf");
        let mut value = luna_next_hocon::load(&path)?;
        let object = value.as_object_mut().ok_or_else(|| {
            Error::Message(format!("Expected package groups in {}", path.display()))
        })?;
        let mut selected = HashSet::new();
        for group in if groups.is_empty() {
            &["core", "main"][..]
        } else {
            groups
        } {
            if selected.insert(group) {
                let value = object.remove(*group).ok_or_else(|| {
                    Error::Message(format!("Missing group '{group}' in {}", path.display()))
                })?;
                let entries = decode(value, &path)?;
                if entries
                    .iter()
                    .any(|package| !matches!(package.source, Source::Pacman | Source::Aur))
                {
                    return Err(Error::Message(format!(
                        "Group '{group}' accepts only pacman and AUR packages in {}",
                        path.display()
                    )));
                }
                packages.extend(entries);
            }
        }
    }
    for (expected, suffix) in [
        (Source::Git, "git"),
        (Source::Mise, "mise"),
        (Source::Local, "local"),
    ] {
        if groups.is_empty() && source.is_none_or(|source| source == expected) {
            let path = directory.join(format!("packages.{suffix}.conf"));
            let entries = decode(luna_next_hocon::load(&path)?, &path)?;
            if entries.iter().any(|package| package.source != expected) {
                return Err(Error::Message(format!(
                    "Expected source '{suffix}' in {}",
                    path.display()
                )));
            }
            packages.extend(entries);
        }
    }
    packages.retain(|package| source.is_none_or(|source| package.source == source));
    let mut seen = HashSet::new();
    for package in &mut packages {
        identifier(&package.name)?;
        if !seen.insert((package.source, package.name.clone())) {
            return Err(Error::Message(format!(
                "Duplicate package '{}'",
                package.name
            )));
        }
        if package.source == Source::Local
            && let Some(url) = &mut package.url
            && !url.trim().is_empty()
            && Path::new(url).is_relative()
        {
            let path = repository.join(&*url);
            *url = path
                .to_str()
                .ok_or_else(|| Error::Message("Local source path is not valid UTF-8.".into()))?
                .to_owned();
        }
    }
    if names.is_empty() {
        return Ok(packages);
    }
    let mut selected = Vec::new();
    let mut seen = HashSet::new();
    for name in names {
        identifier(name)?;
        if !seen.insert(name) {
            continue;
        }
        let mut matches = packages.iter().filter(|package| package.name == *name);
        let package = matches.next();
        if matches.next().is_some() {
            return Err(Error::Message(format!(
                "Package '{name}' has multiple sources; select one."
            )));
        }
        if let Some(package) = package {
            selected.push(package.clone());
        } else if groups.is_empty()
            && source.is_some_and(|source| matches!(source, Source::Pacman | Source::Aur))
        {
            selected.push(Package {
                name: name.clone(),
                source: source.unwrap(),
                ..Package::default()
            });
        } else {
            return Err(Error::Message(format!(
                "Unknown package '{name}' in this selection."
            )));
        }
    }
    Ok(selected)
}

fn decode(value: Value, path: &Path) -> Result<Vec<Package>> {
    serde_json::from_value(value).map_err(|error| {
        Error::Message(format!(
            "Invalid package list '{}': {error}",
            path.display()
        ))
    })
}

/// Install in pacman, Git, AUR, mise, then local order, retaining order within each source.
/// Git runs before AUR so a recipe can provide `yay`. The first error stops later
/// sources; completed installs remain. App config exports are a separate operation.
pub fn install_packages(packages: &[Package]) -> Result<Report> {
    let mut report = Report::default();
    for source in [
        Source::Pacman,
        Source::Git,
        Source::Aur,
        Source::Mise,
        Source::Local,
    ] {
        let selected: Vec<_> = packages
            .iter()
            .filter(|package| package.source == source)
            .cloned()
            .collect();
        if selected.is_empty() {
            continue;
        }
        let installed = install(source, &selected)?;
        report.installed.extend(installed.installed);
        report.skipped.extend(installed.skipped);
    }
    Ok(report)
}
