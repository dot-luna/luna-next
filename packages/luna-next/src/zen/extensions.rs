use std::{
    collections::HashSet,
    fs::{self, File},
    io::{Cursor, Read},
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

use serde::Deserialize;
use url::Url;

use crate::{Error, Result, io_error, process};

const MAX_DOWNLOAD: u64 = 64 * 1024 * 1024;
const MAX_MANIFEST: u64 = 1024 * 1024;

#[derive(Deserialize)]
pub(super) struct Extension {
    pub(super) id: String,
    pub(super) url: String,
}

pub(super) struct Prepared {
    pub(super) id: String,
    pub(super) path: PathBuf,
}

/// Validate the whole list before callers derive profile destination paths.
pub(super) fn validate(extensions: &[Extension]) -> Result<()> {
    let mut ids = HashSet::new();
    for extension in extensions {
        if extension.id.is_empty()
            || extension.id.len() > 200
            || matches!(extension.id.as_str(), "." | "..")
            || !extension
                .id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"@._{}+-".contains(&byte))
        {
            return Err(Error::Message(format!(
                "Invalid Zen extension ID: {}",
                extension.id
            )));
        }
        if !ids.insert(&extension.id) {
            return Err(Error::Message(format!(
                "Duplicate Zen extension ID: {}",
                extension.id
            )));
        }
        let url = Url::parse(&extension.url)
            .map_err(|error| Error::Message(format!("Invalid Zen extension URL: {error}")))?;
        if url.scheme() != "https"
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.fragment().is_some()
            || extension.url.chars().any(char::is_control)
        {
            return Err(Error::Message(
                "Zen extension URLs must use HTTPS without credentials or fragments".into(),
            ));
        }
    }
    Ok(())
}

/// Stage complete XPI downloads without publishing or editing browser registries.
/// Package identity and signature files are checked here; Zen verifies their
/// cryptographic signatures when scanning its profile extension directory.
pub(super) fn prepare(extensions: &[Extension], stage: &Path) -> Result<Vec<Prepared>> {
    validate(extensions)?;
    let metadata = fs::symlink_metadata(stage)
        .map_err(|error| io_error("inspect Zen extension staging directory", stage, error))?;
    if !metadata.is_dir() {
        return Err(Error::Message(
            "Zen extension staging path must be a directory, not a symlink".into(),
        ));
    }
    let mut prepared = Vec::with_capacity(extensions.len());
    for extension in extensions {
        let destination = stage.join(format!("{}.xpi", extension.id));
        match fs::symlink_metadata(&destination) {
            Ok(_) => {
                return Err(Error::Message(format!(
                    "Zen extension staging destination already exists: {}",
                    destination.display()
                )));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(io_error(
                    "inspect Zen extension staging file",
                    &destination,
                    error,
                ));
            }
        }
        let mut command = Command::new("curl");
        // Ignore curlrc so configuration cannot redirect output or allow HTTP redirects.
        command
            .args([
                "--disable",
                "--fail",
                "--location",
                "--silent",
                "--show-error",
                "--globoff",
                "--proto",
                "=https",
                "--proto-redir",
                "=https",
                "--max-redirs",
                "5",
                "--connect-timeout",
                "15",
                "--max-time",
                "120",
                "--max-filesize",
            ])
            .arg(MAX_DOWNLOAD.to_string())
            .arg("--output")
            .arg(&destination)
            .arg("--url")
            .arg(&extension.url);
        let output = process::run(&mut command, Duration::from_secs(125))?;
        process::checked(&format!("download Zen extension {}", extension.id), output)?;
        validate_package(&destination, &extension.id).map_err(|error| {
            Error::Message(format!(
                "Invalid Zen extension package {}: {error}",
                extension.id
            ))
        })?;
        prepared.push(Prepared {
            id: extension.id.clone(),
            path: destination,
        });
    }
    Ok(prepared)
}

fn validate_package(path: &Path, expected_id: &str) -> Result<()> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| io_error("inspect Zen extension download", path, error))?;
    if !metadata.is_file() || metadata.len() > MAX_DOWNLOAD {
        return Err(Error::Message(
            "extension package exceeds 64 MiB or is not a regular file".into(),
        ));
    }
    let mut bytes = Vec::new();
    File::open(path)
        .and_then(|file| file.take(MAX_DOWNLOAD + 1).read_to_end(&mut bytes))
        .map_err(|error| io_error("read Zen extension download", path, error))?;
    if bytes.len() as u64 > MAX_DOWNLOAD {
        return Err(Error::Message("extension package exceeds 64 MiB".into()));
    }
    validate_archive(&bytes, expected_id)
}

fn validate_archive(bytes: &[u8], expected_id: &str) -> Result<()> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|error| Error::Message(format!("invalid extension ZIP archive: {error}")))?;
    for name in [
        "manifest.json",
        "META-INF/manifest.mf",
        "META-INF/mozilla.sf",
        "META-INF/mozilla.rsa",
    ] {
        if archive.file_names().filter(|entry| *entry == name).count() != 1 {
            return Err(Error::Message(format!(
                "extension archive must contain one {name}"
            )));
        }
        let file = archive.by_name(name).map_err(|error| {
            Error::Message(format!(
                "cannot read extension archive entry {name}: {error}"
            ))
        })?;
        if file.size() == 0 || file.size() > MAX_MANIFEST {
            return Err(Error::Message(format!(
                "extension archive entry {name} must be between 1 byte and 1 MiB"
            )));
        }
    }
    let manifest = archive
        .by_name("manifest.json")
        .map_err(|error| Error::Message(format!("cannot read extension manifest: {error}")))?;
    let mut json = Vec::new();
    manifest
        .take(MAX_MANIFEST + 1)
        .read_to_end(&mut json)
        .map_err(|error| {
            Error::Message(format!("cannot decompress extension manifest: {error}"))
        })?;
    if json.len() as u64 > MAX_MANIFEST {
        return Err(Error::Message("extension manifest exceeds 1 MiB".into()));
    }
    let manifest: serde_json::Value = serde_json::from_slice(&json)?;
    let current = manifest
        .pointer("/browser_specific_settings/gecko/id")
        .and_then(|id| id.as_str());
    let legacy = manifest
        .pointer("/applications/gecko/id")
        .and_then(|id| id.as_str());
    if current.or(legacy) != Some(expected_id)
        || current
            .zip(legacy)
            .is_some_and(|(current, legacy)| current != legacy)
    {
        return Err(Error::Message(format!(
            "extension manifest does not declare the expected ID {expected_id}"
        )));
    }
    Ok(())
}

#[cfg(test)]
#[path = "../../tests/unit/zen_extensions.rs"]
mod tests;
