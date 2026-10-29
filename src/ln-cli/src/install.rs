use std::path::Path;

use luna_next::{
    Error, Result,
    install::{Source, find_repository, get_packages, install_packages},
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
    Ok(serde_json::to_value(install_packages(&packages)?)?)
}

pub(crate) fn setup(repository: Option<&Path>) -> Result<Value> {
    let repository = find_repository(repository)?;
    let packages = get_packages(&repository, &[], None, &[])?;
    Ok(serde_json::to_value(install_packages(&packages)?)?)
}
