use std::path::Path;

use luna_next::{
    Error, Result,
    install::{
        Source, configure_installed_apps, find_repository, get_packages, install_app_configs,
        install_app_configs_for_profile, install_packages,
    },
};
use serde_json::Value;

use crate::args::InstallArgs;

pub(crate) fn run(arguments: &InstallArgs) -> Result<Value> {
    let groups: Vec<_> = [(arguments.core, "core"), (arguments.main, "main")]
        .into_iter()
        .filter_map(|(selected, group)| selected.then_some(group))
        .collect();
    let source = [
        (arguments.pacman, Source::Pacman),
        (arguments.aur, Source::Aur),
        (arguments.mise, Source::Mise),
        (arguments.git, Source::Git),
        (arguments.local, Source::Local),
    ]
    .into_iter()
    .find_map(|(selected, source)| selected.then_some(source));
    if groups.is_empty() && source.is_none() && arguments.names.is_empty() {
        return Err(Error::Message(
            "Select a package group, source, or package name.".into(),
        ));
    }
    let repository = find_repository(arguments.repo.as_deref())?;
    let packages = get_packages(&repository, &groups, source, &arguments.names)?;
    let mut report = install_packages(&packages)?;
    let apps: Vec<_> = packages
        .iter()
        .map(|package| package.name.clone())
        .collect();
    if !apps.is_empty() {
        let configurations = configure_installed_apps(&repository, &apps)?;
        report.installed.extend(configurations.installed);
        report.skipped.extend(configurations.skipped);
    }
    Ok(serde_json::to_value(report)?)
}

pub(crate) fn setup(repository: Option<&Path>) -> Result<Value> {
    let repository = find_repository(repository)?;
    let packages = get_packages(&repository, &[], None, &[])?;
    let mut report = install_packages(&packages)?;
    // Configure only after every installation succeeds, when runtime files are available.
    let configurations = install_app_configs(&repository, &[])?;
    report.installed.extend(configurations.installed);
    report.skipped.extend(configurations.skipped);
    luna_next::keyring::setup()?;
    report.installed.push("GNOME Keyring socket".into());
    Ok(serde_json::to_value(report)?)
}

pub(crate) fn configure(
    repository: Option<&Path>,
    names: &[String],
    profile: Option<&Path>,
) -> Result<Value> {
    let repository = find_repository(repository)?;
    let report = match profile {
        Some(profile) => install_app_configs_for_profile(&repository, names, profile)?,
        None => install_app_configs(&repository, names)?,
    };
    Ok(serde_json::to_value(report)?)
}
