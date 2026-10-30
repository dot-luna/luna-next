use std::path::Path;

use crate::{Error, Result};

pub(super) fn script(binary: &Path, user_data_dir: &Path) -> Result<String> {
    Ok(format!(
        "#!/bin/sh\nexec {} {} --profile-directory=Default --no-first-run --no-default-browser-check \"$@\"\n",
        shell(binary)?,
        shell_argument(&format!("--user-data-dir={}", text(user_data_dir)?))
    ))
}

pub(super) fn desktop(launcher: &Path) -> Result<String> {
    let executable = text(launcher)?;
    // Desktop Exec has its own escaping, followed by desktop-entry string decoding.
    let mut escaped = String::new();
    for character in executable.chars() {
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
    Ok(format!(
        "[Desktop Entry]\nType=Application\nName=Chromium (Luna)\nComment=Ungoogled Chromium with the Luna profile\nExec=\"{escaped}\" %U\nIcon=chromium\nTerminal=false\nCategories=Network;WebBrowser;\nMimeType=text/html;x-scheme-handler/http;x-scheme-handler/https;\n"
    ))
}

fn shell(path: &Path) -> Result<String> {
    Ok(shell_argument(text(path)?))
}

fn shell_argument(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn text(path: &Path) -> Result<&str> {
    path.to_str()
        .filter(|value| !value.chars().any(char::is_control))
        .ok_or_else(|| {
            Error::Message("Chromium launch paths must be UTF-8 without control characters".into())
        })
}
