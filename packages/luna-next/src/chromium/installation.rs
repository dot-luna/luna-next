use std::{
    ffi::OsString,
    fs::{self, DirBuilder, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde_json::{Value, json};

use super::{extensions, files, paths};
use crate::{Error, Result, install::copy_tree, io_error, process};

const APPEARANCE: [&str; 2] = ["theme", "websites"];
const MAX_KEY: u64 = 64 * 1024;
const MAX_HEADER: usize = 1024 * 1024;

#[derive(PartialEq)]
struct Previous {
    key: Option<Vec<u8>>,
    version: Option<String>,
    identity: Option<[u8; 16]>,
}

/// Stage signed packages and a local installation page without opening or changing the profile.
/// Existing appearance signing keys are reused; missing, unexpected, or mismatched signer data
/// fails before publication. The caller owns publishing the returned private directory.
pub(super) fn prepare(
    binary: &Path,
    profile: &Path,
    packages: &Path,
    prepared: &[extensions::PreparedExtension],
    appearance: &Path,
    stage: &Path,
) -> Result<PathBuf> {
    let previous = profile.join("Luna Next");
    paths::check(&previous)?;
    check_key_directory(&previous.join("keys"))?;
    let saved = APPEARANCE
        .iter()
        .map(|name| previous_package(&previous, name))
        .collect::<Result<Vec<_>>>()?;
    let values = files::File::open(&profile.join("Preferences"))?.json()?;
    let label = values["profile"]["name"].as_str().unwrap_or_else(|| {
        profile
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Chromium")
    });

    let bundle = stage.join("bundle");
    let packing = stage.join("packing");
    for directory in [
        &bundle,
        &packing,
        &bundle.join("keys"),
        &bundle.join("extensions"),
    ] {
        private_directory(directory)?;
    }
    for extension in prepared {
        if extension.id.len() != 32
            || !extension
                .id
                .bytes()
                .all(|byte| (b'a'..=b'p').contains(&byte))
            || extension.filename != format!("{}.crx", extension.id)
        {
            return Err(Error::Message(
                "Invalid prepared Chromium extension filename".into(),
            ));
        }
        let source = packages.join(&extension.filename);
        paths::check(&source)?;
        if extensions::package_version(&source)? != extension.version {
            return Err(Error::Message(format!(
                "Chromium extension package changed: {}",
                extension.id
            )));
        }
        fs::copy(&source, bundle.join("extensions").join(&extension.filename))
            .map_err(|error| io_error("stage Chromium installation package", &source, error))?;
    }
    for (name, previous) in APPEARANCE.iter().zip(&saved) {
        pack(binary, name, previous, appearance, &packing, &bundle)?;
    }
    private_file(
        &bundle.join("install.html"),
        page(label, profile, prepared).as_bytes(),
    )?;
    check_key_directory(&previous.join("keys"))?;
    for (name, original) in APPEARANCE.iter().zip(&saved) {
        if previous_package(&previous, name)? != *original {
            return Err(Error::Message(format!(
                "Chromium {name} signing files changed externally during packing"
            )));
        }
    }
    Ok(bundle)
}

fn check_key_directory(directory: &Path) -> Result<()> {
    paths::check(directory)?;
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(io_error("read Chromium signing keys", directory, error)),
    };
    for entry in entries {
        let entry =
            entry.map_err(|error| io_error("read Chromium signing keys", directory, error))?;
        if !APPEARANCE
            .iter()
            .any(|name| entry.file_name() == format!("{name}.pem").as_str())
        {
            return Err(Error::Message(format!(
                "Unrecognized Chromium signing key: {}",
                entry.path().display()
            )));
        }
        paths::check(&entry.path())?;
    }
    Ok(())
}

fn previous_package(bundle: &Path, name: &str) -> Result<Previous> {
    let key = read_key(&bundle.join("keys").join(format!("{name}.pem")))?;
    let package = bundle.join(format!("{name}.crx"));
    paths::check(&package)?;
    let version = match fs::symlink_metadata(&package) {
        Ok(_) => Some(extensions::package_version(&package)?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            return Err(io_error(
                "inspect existing Chromium package",
                &package,
                error,
            ));
        }
    };
    if version.is_some() && key.is_none() {
        return Err(Error::Message(format!(
            "Missing signing key for existing Chromium {name} package"
        )));
    }
    let identity = version
        .as_ref()
        .map(|_| package_identity(&package))
        .transpose()?;
    Ok(Previous {
        key,
        version,
        identity,
    })
}

fn read_key(path: &Path) -> Result<Option<Vec<u8>>> {
    paths::check(path)?;
    let file = match OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
    {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(io_error("read Chromium signing key", path, error)),
    };
    let metadata = file
        .metadata()
        .map_err(|error| io_error("inspect Chromium signing key", path, error))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_KEY {
        return Err(Error::Message(format!(
            "Invalid Chromium signing key: {}",
            path.display()
        )));
    }
    let mut bytes = Vec::new();
    file.take(MAX_KEY + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| io_error("read Chromium signing key", path, error))?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_KEY {
        return Err(Error::Message(format!(
            "Invalid Chromium signing key: {}",
            path.display()
        )));
    }
    Ok(Some(bytes))
}

fn pack(
    binary: &Path,
    name: &str,
    previous: &Previous,
    appearance: &Path,
    packing: &Path,
    bundle: &Path,
) -> Result<()> {
    let source = appearance.join(name);
    paths::check(&source)?;
    let source_root = fs::canonicalize(&source)
        .map_err(|error| io_error("locate Chromium appearance source", &source, error))?;
    let directory = packing.join(name);
    private_directory(&directory)?;
    copy_tree(&source_root, &directory, &source_root)?;
    let manifest_path = directory.join("manifest.json");
    let mut manifest: Value = serde_json::from_slice(
        &fs::read(&manifest_path)
            .map_err(|error| io_error("read staged Chromium manifest", &manifest_path, error))?,
    )?;
    let version = next_version(previous.version.as_deref())?;
    manifest
        .as_object_mut()
        .ok_or_else(|| Error::Message("Chromium appearance manifest must be an object".into()))?
        .insert("version".into(), json!(version));
    fs::write(&manifest_path, serde_json::to_vec_pretty(&manifest)?)
        .map_err(|error| io_error("stage Chromium appearance version", &manifest_path, error))?;
    let key_path = bundle.join("keys").join(format!("{name}.pem"));
    if let Some(key) = &previous.key {
        private_file(&key_path, key)?;
    }

    let mut command = Command::new(binary);
    command
        .args(["--headless", "--no-first-run", "--no-default-browser-check"])
        .arg(argument("--user-data-dir=", &packing.join("browser")))
        .arg(argument("--pack-extension=", &directory));
    if previous.key.is_some() {
        command.arg(argument("--pack-extension-key=", &key_path));
    }
    let output = process::run(&mut command, Duration::from_secs(30))?;
    process::checked(&format!("pack Chromium {name}"), output)?;
    let package = directory.with_extension("crx");
    paths::check(&package)?;
    if extensions::package_version(&package)? != version {
        return Err(Error::Message(format!(
            "Packed Chromium {name} has an unexpected version"
        )));
    }
    let identity = package_identity(&package)?;
    if previous
        .identity
        .is_some_and(|previous| previous != identity)
    {
        return Err(Error::Message(format!(
            "Chromium {name} signing key does not match the existing package"
        )));
    }
    if previous.key.is_none() {
        let generated_key = directory.with_extension("pem");
        let key = read_key(&generated_key)?.ok_or_else(|| {
            Error::Message(format!("Chromium did not produce a signing key for {name}"))
        })?;
        fs::set_permissions(&generated_key, fs::Permissions::from_mode(0o600)).map_err(
            |error| {
                io_error(
                    "protect generated Chromium signing key",
                    &generated_key,
                    error,
                )
            },
        )?;
        private_file(&key_path, &key)?;
    }
    fs::rename(&package, bundle.join(format!("{name}.crx")))
        .map_err(|error| io_error("stage signed Chromium appearance", &package, error))
}

fn next_version(previous: Option<&str>) -> Result<String> {
    let now: u64 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| Error::Message("System clock precedes the Unix epoch".into()))?
        .as_millis()
        .try_into()
        .map_err(|_| Error::Message("System clock exceeds Chromium version range".into()))?;
    let previous = previous
        .map(|version| {
            let mut components = version.split('.').map(str::parse::<u16>);
            let mut encoded = 0u64;
            for _ in 0..4 {
                encoded = (encoded << 16)
                    | u64::from(
                        components
                            .next()
                            .transpose()
                            .map_err(|_| {
                                Error::Message(
                                    "Invalid existing Chromium appearance version".into(),
                                )
                            })?
                            .unwrap_or(0),
                    );
            }
            if components.next().is_some() {
                return Err(Error::Message(
                    "Invalid existing Chromium appearance version".into(),
                ));
            }
            encoded.checked_add(1).ok_or_else(|| {
                Error::Message("Chromium appearance version cannot increase further".into())
            })
        })
        .transpose()?
        .unwrap_or(1);
    let encoded = now.max(previous);
    Ok(format!(
        "{}.{}.{}.{}",
        (encoded >> 48) as u16,
        (encoded >> 32) as u16,
        (encoded >> 16) as u16,
        encoded as u16
    ))
}

/// Compare native packer's declared IDs without treating metadata parsing as signature verification.
fn package_identity(path: &Path) -> Result<[u8; 16]> {
    let mut file = fs::File::open(path)
        .map_err(|error| io_error("read Chromium package identity", path, error))?;
    let mut prefix = [0u8; 12];
    file.read_exact(&mut prefix)
        .map_err(|error| io_error("read Chromium package header", path, error))?;
    let size = u32::from_le_bytes(prefix[8..12].try_into().unwrap()) as usize;
    if &prefix[..4] != b"Cr24"
        || u32::from_le_bytes(prefix[4..8].try_into().unwrap()) != 3
        || size == 0
        || size > MAX_HEADER
    {
        return Err(Error::Message("Invalid native Chromium CRX3 header".into()));
    }
    let mut header = vec![0; size];
    file.read_exact(&mut header)
        .map_err(|error| io_error("read Chromium signed header", path, error))?;
    let signed = bytes_field(&header, 10000)?;
    bytes_field(signed, 1)?
        .try_into()
        .map_err(|_| Error::Message("Native Chromium package ID must contain 16 bytes".into()))
}

fn bytes_field(mut message: &[u8], wanted: u64) -> Result<&[u8]> {
    let mut found = None;
    while !message.is_empty() {
        let tag = varint(&mut message)?;
        if tag & 7 != 2 {
            return Err(Error::Message(
                "Invalid native Chromium signed-header field".into(),
            ));
        }
        let length: usize = varint(&mut message)?.try_into().map_err(|_| {
            Error::Message("Native Chromium signed-header field is too large".into())
        })?;
        let (value, remainder) = message.split_at_checked(length).ok_or_else(|| {
            Error::Message("Truncated native Chromium signed-header field".into())
        })?;
        if tag >> 3 == wanted {
            if found.is_some() {
                return Err(Error::Message(
                    "Duplicate native Chromium package identity".into(),
                ));
            }
            found = Some(value);
        }
        message = remainder;
    }
    found.ok_or_else(|| {
        Error::Message("Native Chromium package is missing its signed identity".into())
    })
}

fn varint(message: &mut &[u8]) -> Result<u64> {
    let mut value = 0;
    for shift in (0..=63).step_by(7) {
        let Some((&byte, rest)) = message.split_first() else {
            break;
        };
        *message = rest;
        if shift == 63 && byte > 1 {
            break;
        }
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Ok(value);
        }
    }
    Err(Error::Message(
        "Invalid native Chromium signed-header varint".into(),
    ))
}

fn private_directory(path: &Path) -> Result<()> {
    DirBuilder::new()
        .mode(0o700)
        .create(path)
        .map_err(|error| io_error("stage private Chromium directory", path, error))
}

fn private_file(path: &Path, bytes: &[u8]) -> Result<()> {
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .and_then(|mut file| file.write_all(bytes))
        .map_err(|error| io_error("stage private Chromium file", path, error))
}

fn argument(prefix: &str, path: &Path) -> OsString {
    let mut argument = OsString::from(prefix);
    argument.push(path);
    argument
}

fn page(label: &str, profile: &Path, extensions: &[extensions::PreparedExtension]) -> String {
    let mut links = String::new();
    for extension in extensions {
        let name = match extension.id.as_str() {
            "epcnnfbjfcgphgdmggkamkmgojdagdnn" => "uBlock",
            "mnjggcdmjocbbbhaepdhchncahnbgone" => "SponsorBlock for YouTube",
            "kmfcinojnfabkpndlgomnfjllgeppegb" => "YouTube Custom Speed",
            "cmedhionkhpnakcndndgjdbohmhepckk" => "Adblock for YouTube",
            _ => "Extension",
        };
        links.push_str(&format!(
            "<li><a href=\"extensions/{}\">{name}</a> <code>{}</code></li>\n",
            html(&extension.filename),
            html(&extension.id)
        ));
    }
    format!(
        "<!doctype html>\n<html lang=\"en\"><meta charset=\"utf-8\"><title>Luna Chromium installation</title>\n<h1>Finish Chromium setup</h1>\n<p>Profile: <strong>{}</strong><br><code>{}</code></p>\n<p>Open each package below in this profile. Review its permissions and choose <strong>Add extension</strong> or <strong>Add theme</strong>.</p>\n<ol>\n{links}<li><a href=\"theme.crx\">Luna browser theme</a></li>\n<li><a href=\"websites.crx\">Luna website appearance</a></li>\n</ol>\n<p>Check the results in <a href=\"chrome://extensions/\">chrome://extensions/</a>. Open the updated packages again after reapplying Luna configuration.</p>\n</html>\n",
        html(label),
        html(&profile.to_string_lossy())
    )
}

fn html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
#[path = "../../tests/unit/chromium_installation.rs"]
mod tests;
