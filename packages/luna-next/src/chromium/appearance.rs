//! Native browser colors and website styles generated from a resolved Luna theme.

use std::{
    collections::hash_map::DefaultHasher,
    fmt::Write as _,
    fs,
    hash::{Hash, Hasher},
    path::Path,
};

use serde_json::{Map, Value, json};

use crate::{Error, Result, io_error};

// Native keys are limited to Chromium's kOverwritableColorTable.
const COLORS: &[(&str, &str)] = &[
    ("frame", "dark_background"),
    ("frame_inactive", "darker_background"),
    ("toolbar", "background"),
    ("toolbar_text", "foreground"),
    ("toolbar_button_icon", "foreground"),
    ("bookmark_text", "foreground"),
    ("button_background", "lighter_background"),
    ("background_tab", "dark_background"),
    ("background_tab_inactive", "darker_background"),
    ("tab_text", "foreground"),
    ("tab_background_text", "light_foreground"),
    ("tab_background_text_inactive", "dark_foreground"),
    ("omnibox_background", "lighter_background"),
    ("omnibox_text", "foreground"),
    ("ntp_background", "background"),
    ("ntp_text", "foreground"),
    ("ntp_link", "link"),
    ("ntp_header", "accent"),
];

/// Generate unpacked theme and website extensions in caller-owned staging.
/// The caller supplies a resolved, schema-validated Luna theme and publishes/loads
/// these assets separately. Website CSS affects matching HTTP(S) documents;
/// selectors do not pierce shadow roots or style native browser controls, and
/// Chromium excludes protected pages from extension injection.
/// Native Chromium themes support colors but provide no browser UI font override.
pub(super) fn prepare(theme: &Value, stage: &Path) -> Result<()> {
    let mut colors = Map::new();
    for &(target, source) in COLORS {
        let value = text(&theme["colors"][source], &format!("colors.{source}"))?;
        let color = value
            .strip_prefix('#')
            .and_then(|value| u32::from_str_radix(value, 16).ok())
            .ok_or_else(|| {
                Error::Message(format!("Cannot convert Luna color '{source}' to RGB"))
            })?;
        colors.insert(
            target.into(),
            json!([(color >> 16) & 255, (color >> 8) & 255, color & 255]),
        );
    }
    let mut native = json!({
        "manifest_version": 3,
        "name": "Luna Next Browser Theme",
        "theme": {"colors": colors}
    });
    native["version"] = json!(version(&native, "")?);

    let ui = css_string(text(&theme["fonts"]["ui"], "fonts.ui")?);
    let mono = css_string(text(&theme["fonts"]["mono"], "fonts.mono")?);
    // A universal font override would also replace explicit icon-font families.
    let css = format!(
        "*, *::before, *::after {{ border-radius: 0 !important; }}\n\
         body, button, input, optgroup, option, select, textarea {{\n  \
         font-family: {ui}, sans-serif !important;\n}}\n\
         pre, code, kbd, samp, pre *, code *, kbd *, samp * {{\n  \
         font-family: {mono}, monospace !important;\n}}\n"
    );
    let mut websites = json!({
        "manifest_version": 3,
        "name": "Luna Next Website Appearance",
        "content_scripts": [{
            "matches": ["http://*/*", "https://*/*"],
            "css": ["style.css"],
            "all_frames": true,
            "run_at": "document_start"
        }]
    });
    websites["version"] = json!(version(&websites, &css)?);

    for directory in [stage.join("theme"), stage.join("websites")] {
        fs::create_dir_all(&directory)
            .map_err(|error| io_error("stage Chromium appearance", &directory, error))?;
    }
    write(
        &stage.join("theme/manifest.json"),
        &serde_json::to_vec_pretty(&native)?,
    )?;
    write(
        &stage.join("websites/manifest.json"),
        &serde_json::to_vec_pretty(&websites)?,
    )?;
    write(&stage.join("websites/style.css"), css.as_bytes())
}

fn text<'a>(value: &'a Value, name: &str) -> Result<&'a str> {
    value
        .as_str()
        .ok_or_else(|| Error::Message(format!("Resolved Luna theme is missing '{name}'")))
}

fn css_string(value: &str) -> String {
    let mut escaped = String::from("\"");
    for character in value.chars() {
        match character {
            '\\' | '"' => {
                escaped.push('\\');
                escaped.push(character);
            }
            '\0' => escaped.push('\u{fffd}'),
            character if character.is_control() => {
                // A trailing space terminates the escape before a following hex digit.
                write!(escaped, "\\{:x} ", character as u32).unwrap();
            }
            _ => escaped.push(character),
        }
    }
    escaped.push('"');
    escaped
}

fn version(manifest: &Value, css: &str) -> Result<String> {
    let mut hash = DefaultHasher::new();
    serde_json::to_vec(manifest)?.hash(&mut hash);
    css.hash(&mut hash);
    // Chromium caches themes by version. This content fingerprint is not a signature.
    let fingerprint = hash.finish().max(1);
    Ok(format!(
        "{}.{}.{}.{}",
        (fingerprint >> 48) as u16,
        (fingerprint >> 32) as u16,
        (fingerprint >> 16) as u16,
        fingerprint as u16
    ))
}

fn write(path: &Path, bytes: &[u8]) -> Result<()> {
    fs::write(path, bytes).map_err(|error| io_error("stage Chromium appearance file", path, error))
}

#[cfg(test)]
#[path = "../../tests/unit/chromium_appearance.rs"]
mod tests;
