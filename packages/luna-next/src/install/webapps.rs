use std::{collections::HashSet, path::Path};

use serde::Deserialize;

use super::Report;
use crate::{Error, Result, chromium, webapp};

/// A desktop web app installed with Luna's existing default Chromium profile.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Webapp {
    pub name: String,
    pub url: String,
    /// Omission discovers the site's icon; an explicit HTTP(S) image skips discovery.
    pub icon_url: Option<String>,
}

/// Read the required `installs/packages.webapp.conf` HOCON array without changing files.
/// Includes resolve relative to their source files. Invalid fields, names, HTTP(S)
/// URLs, and duplicate names after trimming are errors before installation starts.
pub fn get_webapps(repository: &Path) -> Result<Vec<Webapp>> {
    let path = repository.join("installs/packages.webapp.conf");
    let recipes: Vec<Webapp> =
        serde_json::from_value(luna_next_hocon::load(&path)?).map_err(|error| {
            Error::Message(format!(
                "Invalid web app list '{}': {error}",
                path.display()
            ))
        })?;
    validate(&recipes)?;
    Ok(recipes)
}

/// Install the catalog in order through [`webapp::Webapps::install`], using the
/// existing default profile and the supplied installed Luna executable.
/// All recipe fields and duplicate names are checked before any download or export.
/// Later download/publication failures retain completed apps; no browser is opened.
/// An empty catalog succeeds without inspecting environment, launcher, or browser paths.
pub fn install_webapps(recipes: &[Webapp], launcher: &Path) -> Result<Report> {
    validate(recipes)?;
    let mut report = Report::default();
    if recipes.is_empty() {
        return Ok(report);
    }
    let webapps = webapp::Webapps::from_env(launcher)?;
    for recipe in recipes {
        let installed =
            webapps.install(&recipe.name, &recipe.url, None, recipe.icon_url.as_deref())?;
        report.installed.push(installed.name);
    }
    Ok(report)
}

fn validate(recipes: &[Webapp]) -> Result<()> {
    let mut names = HashSet::new();
    for recipe in recipes {
        let name = webapp::validated_name(&recipe.name)?;
        if !names.insert(name) {
            return Err(Error::Message(format!("Duplicate web app '{name}'")));
        }
        chromium::app_url(&recipe.url)?;
        if let Some(icon_url) = &recipe.icon_url {
            chromium::app_url(icon_url)?;
        }
    }
    Ok(())
}
