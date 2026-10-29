use super::files::media_type;
use super::process::run;
use super::{STAGING_PREFIX, message};
use crate::{Result, io_error};
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;
use url::Url;

const MAX_DOWNLOAD: u64 = 512 * 1024 * 1024;

pub(super) fn download(target: &str, directory: &Path, index: usize) -> Result<PathBuf> {
    let url =
        Url::parse(target).map_err(|error| message(format!("Invalid wallpaper URL: {error}")))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(message("Only HTTP and HTTPS wallpaper URLs are supported"));
    }
    let folder = directory.join(index.to_string());
    fs::create_dir(&folder)
        .map_err(|error| io_error("stage wallpaper download", &folder, error))?;
    let payload = folder.join("payload");
    let mut command = Command::new("curl");
    command
        .args([
            "--disable",
            "--fail",
            "--location",
            "--silent",
            "--show-error",
            "--globoff",
            "--proto",
            "=http,https",
            "--proto-redir",
            "=http,https",
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
        .arg(&payload)
        .arg("--url")
        .arg(url.as_str());
    run(&mut command, Duration::from_secs(125))?;
    let extension = media_extension(&media_type(&payload)?)?;
    let destination = folder.join(download_filename(&url, index, extension));
    fs::rename(&payload, &destination)
        .map_err(|error| io_error("name wallpaper download", &destination, error))?;
    Ok(destination)
}

fn media_extension(mime: &str) -> Result<&'static str> {
    Ok(match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/bmp" | "image/x-ms-bmp" => "bmp",
        "image/svg+xml" => "svg",
        "image/gif" => "gif",
        "image/avif" => "avif",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        "video/x-matroska" => "mkv",
        "video/quicktime" => "mov",
        "video/x-msvideo" => "avi",
        "video/ogg" | "application/ogg" => "ogv",
        _ => {
            return Err(message(format!(
                "Unsupported downloaded wallpaper format: {mime}"
            )));
        }
    })
}

fn download_filename(url: &Url, index: usize, extension: &str) -> String {
    let raw_name = url
        .path_segments()
        .and_then(|mut parts| parts.next_back())
        .unwrap_or("");
    let decoded = percent_decode(raw_name);
    let safe: String = decoded
        .chars()
        .map(|ch| {
            if ch.is_control() || matches!(ch, '/' | '\\') {
                '_'
            } else {
                ch
            }
        })
        .scan(0, |length, ch| {
            *length += ch.len_utf8();
            (*length <= 160).then_some(ch)
        })
        .collect();
    let stem = Path::new(&safe)
        .file_stem()
        .and_then(OsStr::to_str)
        .unwrap_or("");
    let stem = if matches!(stem, "" | "." | "..") || stem.starts_with(STAGING_PREFIX) {
        format!("wallpaper-{}", index + 1)
    } else {
        stem.to_owned()
    };
    format!("{stem}.{extension}")
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%'
            && index + 2 < bytes.len()
            && let (Some(high), Some(low)) = (
                (bytes[index + 1] as char).to_digit(16),
                (bytes[index + 2] as char).to_digit(16),
            )
        {
            decoded.push((high * 16 + low) as u8);
            index += 3;
            continue;
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&decoded).into_owned()
}
