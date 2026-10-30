use std::path::Path;

use crate::{Error, Result};

pub(super) fn entry(
    name: &str,
    url: &str,
    launcher: &Path,
    profile: Option<&Path>,
    icon: &Path,
) -> Result<String> {
    // GLib checks the executable before expanding field codes. A fixed executable
    // lets a percent in the Luna path survive as an escaped argument instead.
    let mut command = format!(
        "/usr/bin/env -- {} webapp launch {}",
        argument(text(launcher)?)?,
        argument(url)?
    );
    if let Some(profile) = profile {
        command.push_str(" --profile ");
        command.push_str(&argument(text(profile)?)?);
    }
    Ok(format!(
        "[Desktop Entry]\nType=Application\nName={}\nExec={command}\nIcon={}\nTerminal=false\nCategories=Network;\n",
        value(name),
        value(text(icon)?)
    ))
}

pub(super) fn text(path: &Path) -> Result<&str> {
    path.to_str()
        .filter(|value| !value.chars().any(char::is_control))
        .ok_or_else(|| {
            Error::Message("Web app paths must be UTF-8 without control characters".into())
        })
}

fn value(value: &str) -> String {
    value.replace('\\', "\\\\")
}

// Exec first decodes desktop-entry strings, then parses quoted arguments and field codes.
// Keep each URL/path one argument, and escape '%' so URLs cannot introduce field codes.
fn argument(value: &str) -> Result<String> {
    if value.chars().any(char::is_control) {
        return Err(Error::Message(
            "Web app arguments must not contain control characters".into(),
        ));
    }
    let mut escaped = String::from("\"");
    for character in value.chars() {
        match character {
            '%' => escaped.push_str("%%"),
            '\\' => escaped.push_str("\\\\\\\\"),
            '"' | '`' | '$' => {
                escaped.push_str("\\\\");
                escaped.push(character);
            }
            _ => escaped.push(character),
        }
    }
    escaped.push('"');
    Ok(escaped)
}

#[cfg(test)]
#[path = "../../tests/unit/webapp_desktop.rs"]
mod tests;
