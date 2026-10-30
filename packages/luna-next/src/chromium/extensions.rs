use std::{
    collections::HashSet,
    fs::{self, File},
    io::{Cursor, Read},
    path::Path,
    process::Command,
    time::Duration,
};

use serde::Deserialize;
use url::Url;

use crate::{Error, Result, io_error, process};

const MAX_DOWNLOAD: u64 = 128 * 1024 * 1024;
const MAX_HEADER: usize = 1024 * 1024;
const MAX_MANIFEST: u64 = 1024 * 1024;

pub(super) struct PreparedExtension {
    pub(super) id: String,
    pub(super) version: String,
    pub(super) filename: String,
}

/// Download every package into caller-owned staging before publication.
/// This checks CRX3 framing and the ZIP manifest; Chromium verifies the package
/// signature and derives its identity when the user accepts the native installation.
pub(super) fn prepare(
    ids: &[String],
    browser_version: &str,
    stage: &Path,
) -> Result<Vec<PreparedExtension>> {
    let mut unique = HashSet::new();
    for id in ids {
        if id.len() != 32 || !id.bytes().all(|byte| (b'a'..=b'p').contains(&byte)) {
            return Err(Error::Message(format!(
                "Invalid Chromium extension ID: {id}"
            )));
        }
        if !unique.insert(id) {
            return Err(Error::Message(format!(
                "Duplicate Chromium extension ID: {id}"
            )));
        }
    }

    let mut extensions = Vec::with_capacity(ids.len());
    for id in ids {
        let filename = format!("{id}.crx");
        let destination = stage.join(&filename);
        let mut url = Url::parse("https://clients2.google.com/service/update2/crx")
            .expect("static Web Store endpoint is valid");
        url.query_pairs_mut()
            .append_pair("response", "redirect")
            .append_pair("acceptformat", "crx2,crx3")
            .append_pair("prodversion", browser_version)
            .append_pair("x", &format!("id={id}&installsource=ondemand&uc"));

        let mut command = Command::new("curl");
        // curlrc must not redirect output or widen the allowed redirect schemes.
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
            .arg(url.as_str());
        let output = process::run(&mut command, Duration::from_secs(125))?;
        process::checked(&format!("download Chromium extension {id}"), output)?;
        let version = package_version(&destination).map_err(|error| {
            Error::Message(format!("Invalid Chromium extension package {id}: {error}"))
        })?;
        extensions.push(PreparedExtension {
            id: id.clone(),
            version,
            filename,
        });
    }
    Ok(extensions)
}

pub(super) fn package_version(path: &Path) -> Result<String> {
    let metadata = fs::metadata(path)
        .map_err(|error| io_error("inspect Chromium extension download", path, error))?;
    if !metadata.is_file() || metadata.len() > MAX_DOWNLOAD {
        return Err(Error::Message(
            "extension package exceeds 128 MiB or is not a file".into(),
        ));
    }
    let mut bytes = Vec::new();
    File::open(path)
        .and_then(|file| file.take(MAX_DOWNLOAD + 1).read_to_end(&mut bytes))
        .map_err(|error| io_error("read Chromium extension download", path, error))?;
    if bytes.len() as u64 > MAX_DOWNLOAD {
        return Err(Error::Message("extension package exceeds 128 MiB".into()));
    }
    manifest_version(&bytes)
}

fn manifest_version(package: &[u8]) -> Result<String> {
    if package.len() < 12
        || &package[..4] != b"Cr24"
        || u32::from_le_bytes(package[4..8].try_into().unwrap()) != 3
    {
        return Err(Error::Message("expected a CRX3 package".into()));
    }
    let header_size = u32::from_le_bytes(package[8..12].try_into().unwrap()) as usize;
    if header_size == 0 || header_size > MAX_HEADER {
        return Err(Error::Message("invalid CRX3 header size".into()));
    }
    let archive_start = 12 + header_size;
    if package.get(archive_start..archive_start + 4) != Some(b"PK\x03\x04") {
        return Err(Error::Message(
            "missing ZIP archive after CRX3 header".into(),
        ));
    }
    let mut archive = zip::ZipArchive::new(Cursor::new(&package[archive_start..]))
        .map_err(|error| Error::Message(format!("invalid extension ZIP archive: {error}")))?;
    if archive
        .file_names()
        .filter(|name| *name == "manifest.json")
        .count()
        != 1
    {
        return Err(Error::Message(
            "extension archive must contain one manifest.json".into(),
        ));
    }
    let manifest = archive
        .by_name("manifest.json")
        .map_err(|error| Error::Message(format!("cannot read extension manifest: {error}")))?;
    if manifest.size() > MAX_MANIFEST {
        return Err(Error::Message("extension manifest exceeds 1 MiB".into()));
    }
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

    #[derive(Deserialize)]
    struct Manifest {
        version: String,
    }
    let manifest: Manifest = serde_json::from_slice(&json)?;
    if !valid_version(&manifest.version) {
        return Err(Error::Message(format!(
            "invalid extension version: {}",
            manifest.version
        )));
    }
    Ok(manifest.version)
}

fn valid_version(version: &str) -> bool {
    let components: Vec<_> = version.split('.').collect();
    (1..=4).contains(&components.len())
        && components.iter().all(|component| {
            !component.is_empty()
                && component.bytes().all(|byte| byte.is_ascii_digit())
                && (component.len() == 1 || !component.starts_with('0'))
                && component.parse::<u16>().is_ok()
        })
        && components.iter().any(|component| *component != "0")
}

#[cfg(test)]
#[path = "../../tests/unit/chromium_extensions.rs"]
mod tests;
