use std::{fs, process::Command};

use serde_json::{Map, json};

use super::{Themes, values};
use crate::{Error, Result, config_io, io_error};

const SCHEMA: &str = "org.gnome.desktop.interface";
const KEY: &str = "color-scheme";

fn gsettings(arguments: &[&str]) -> Result<String> {
    let output = Command::new("gsettings")
        .args(arguments)
        .output()
        .map_err(|error| Error::Message(format!("cannot run gsettings: {error}")))?;
    if !output.status.success() {
        return Err(Error::Message(format!(
            "gsettings failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn preference() -> Result<String> {
    let value = gsettings(&["get", SCHEMA, KEY])?;
    let value = value.trim_matches('\'');
    match value {
        "default" | "prefer-dark" | "prefer-light" => Ok(value.to_owned()),
        _ => Err(Error::Message(format!(
            "unknown desktop appearance preference: {value}"
        ))),
    }
}

fn apply_preference(value: &str) -> Result<()> {
    gsettings(&["set", SCHEMA, KEY, value])?;
    if preference()? != value {
        return Err(Error::Message(
            "desktop appearance preference was not saved".into(),
        ));
    }
    Ok(())
}

impl Themes {
    /// Read the desktop preference. When the system has no preference, use the saved
    /// mode or selected palette's mode. Does not rewrite theme colors.
    pub fn mode(&self) -> Result<String> {
        match preference()?.as_str() {
            "prefer-dark" => Ok("dark".into()),
            "prefer-light" => Ok("light".into()),
            _ => {
                if let Some(mode) = self.selection()?.get("theme.mode")?.as_str() {
                    Ok(mode.to_owned())
                } else {
                    Ok(self.get(Some("colors.mode"))?.as_str().unwrap().to_owned())
                }
            }
        }
    }

    /// Apply `dark` or `light` through GSettings and save the preference in HOCON.
    /// Fixed application palettes and legacy GTK settings are not rewritten.
    pub fn set_mode(&self, mode: &str) -> Result<String> {
        let _lock = config_io::lock(&self.paths.config_file)?;
        self.save_appearance(None, mode)?;
        Ok(mode.to_owned())
    }

    /// Switch the effective system mode, saving it without changing theme colors.
    pub fn toggle(&self) -> Result<String> {
        let _lock = config_io::lock(&self.paths.config_file)?;
        let mode = if self.mode()? == "dark" {
            "light"
        } else {
            "dark"
        };
        self.save_appearance(None, mode)?;
        Ok(mode.to_owned())
    }

    pub(super) fn save_appearance(&self, name: Option<&str>, mode: &str) -> Result<()> {
        let schema = values::selection_schema()?;
        let mut patch = json!({"theme": {"mode": mode}});
        if let Some(name) = name {
            patch["theme"]["name"] = json!(name);
        }
        luna_next_hocon::validate_value(&patch, &schema)?;
        let mut config = self.selection()?;
        let original = config.source().to_owned();
        let canonical = fs::canonicalize(&self.paths.config_file)
            .map_err(|error| io_error("locate theme selection", &self.paths.config_file, error))?;
        let permissions = fs::metadata(&canonical)
            .map_err(|error| io_error("read permissions of", &canonical, error))?
            .permissions();
        let previous = preference()?;
        let target = format!("prefer-{mode}");
        let mut changes = Map::new();
        changes.insert("theme.mode".into(), json!(mode));
        if let Some(name) = name {
            changes.insert("theme.name".into(), json!(name));
        }
        config.set_many_validated(&changes, &schema)?;
        if previous == target {
            return Ok(());
        }

        if let Err(error) = apply_preference(&target) {
            let mut failures = vec![error.to_string()];
            // Failed commands may still have applied the value. Restore only our own change.
            match preference() {
                Ok(current) if current == target => {
                    if let Err(error) = apply_preference(&previous) {
                        failures.push(format!("could not restore desktop preference: {error}"));
                    }
                }
                Ok(current) if current == previous => {}
                Ok(_) => failures
                    .push("desktop preference changed externally; leaving it untouched".into()),
                Err(error) => failures.push(format!(
                    "could not inspect desktop preference for recovery: {error}"
                )),
            }
            if let Err(error) =
                config_io::restore(&canonical, config.source(), &original, permissions)
            {
                failures.push(format!("could not restore theme selection: {error}"));
            }
            return Err(Error::Message(failures.join("; ")));
        }
        Ok(())
    }
}
