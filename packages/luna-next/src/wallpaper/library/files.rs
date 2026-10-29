use super::process::run;
use super::{STAGING_PREFIX, message};
use crate::{Result, io_error};
use std::ffi::OsStr;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

pub(super) fn resolve_target(
    target: &str,
    library_only: bool,
    entries: &[PathBuf],
) -> Result<PathBuf> {
    check_path(Path::new(target))?;
    let requested = Path::new(target);
    let canonical = fs::canonicalize(requested).ok();
    let mut matches = entries.iter().filter(|path| {
        path.as_path() == requested
            || canonical.as_ref() == Some(*path)
            || path.file_name() == Some(OsStr::new(target))
    });
    let first = matches.next();
    if matches.next().is_some() {
        return Err(message(format!(
            "Ambiguous wallpaper; use its full library path: {target}"
        )));
    }
    if let Some(path) = first {
        return Ok(path.clone());
    }
    if !library_only {
        let path = canonicalize(requested)?;
        if !path.is_file() {
            return Err(message(format!("Wallpaper file not found: {target}")));
        }
        return Ok(path);
    }
    Err(message(format!("Wallpaper not found in library: {target}")))
}

fn check_path(path: &Path) -> Result<()> {
    if path.as_os_str().is_empty() || path.to_string_lossy().chars().any(char::is_control) {
        return Err(message(
            "Wallpaper paths must be nonempty and contain no control characters",
        ));
    }
    Ok(())
}

pub(super) fn canonicalize(path: &Path) -> Result<PathBuf> {
    check_path(path)?;
    fs::canonicalize(path).map_err(|error| io_error("resolve wallpaper path", path, error))
}

pub(super) fn destination_exists(path: &Path) -> Result<bool> {
    destination_metadata(path).map(|metadata| metadata.is_some())
}

pub(super) fn destination_metadata(path: &Path) -> Result<Option<fs::Metadata>> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() && !metadata.is_symlink() => Ok(Some(metadata)),
        Ok(_) => Err(message(format!(
            "Wallpaper destination must be a regular file, not a symlink or directory: {}",
            path.display()
        ))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(io_error("inspect wallpaper destination", path, error)),
    }
}

pub(super) fn scan(
    directory: &Path,
    recursive: bool,
    filter_extensions: bool,
) -> Result<Vec<PathBuf>> {
    let entries = fs::read_dir(directory)
        .map_err(|error| io_error("scan wallpaper directory", directory, error))?;
    let mut paths = Vec::new();
    for entry in entries {
        let entry =
            entry.map_err(|error| io_error("scan wallpaper directory", directory, error))?;
        let path = entry.path();
        let kind = entry
            .file_type()
            .map_err(|error| io_error("inspect wallpaper entry", &path, error))?;
        if entry
            .file_name()
            .to_string_lossy()
            .starts_with(STAGING_PREFIX)
        {
            continue;
        }
        if kind.is_file() && (!filter_extensions || supported_extension(&path)) {
            paths.push(path);
        } else if kind.is_dir() && recursive {
            paths.extend(scan(&path, true, filter_extensions)?);
        }
    }
    paths.sort();
    Ok(paths)
}

fn supported_extension(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(OsStr::to_str)
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some(
            "png"
                | "jpg"
                | "jpeg"
                | "webp"
                | "bmp"
                | "svg"
                | "gif"
                | "apng"
                | "avif"
                | "mp4"
                | "m4v"
                | "webm"
                | "mkv"
                | "mov"
                | "avi"
                | "ogv"
        )
    )
}

pub(super) fn same_contents(left: &Path, right: &Path) -> Result<bool> {
    let mut left_file =
        File::open(left).map_err(|error| io_error("read wallpaper", left, error))?;
    let mut right_file =
        File::open(right).map_err(|error| io_error("read wallpaper", right, error))?;
    if left_file
        .metadata()
        .map_err(|error| io_error("inspect wallpaper", left, error))?
        .len()
        != right_file
            .metadata()
            .map_err(|error| io_error("inspect wallpaper", right, error))?
            .len()
    {
        return Ok(false);
    }
    let mut left_bytes = [0; 64 * 1024];
    let mut right_bytes = [0; 64 * 1024];
    loop {
        let count = left_file
            .read(&mut left_bytes)
            .map_err(|error| io_error("read wallpaper", left, error))?;
        if count == 0 {
            return Ok(true);
        }
        right_file
            .read_exact(&mut right_bytes[..count])
            .map_err(|error| io_error("read wallpaper", right, error))?;
        if left_bytes[..count] != right_bytes[..count] {
            return Ok(false);
        }
    }
}

pub(super) fn media_type(path: &Path) -> Result<String> {
    check_path(path)?;
    if !fs::metadata(path)
        .map_err(|error| io_error("inspect wallpaper", path, error))?
        .is_file()
    {
        return Err(message(format!(
            "Wallpaper is not a regular file: {}",
            path.display()
        )));
    }
    let mut command = Command::new("file");
    command.args(["--brief", "--mime-type", "--"]).arg(path);
    let output = run(&mut command, Duration::from_secs(10))?;
    let mime = output.trim().to_owned();
    if !mime.starts_with("image/") && !mime.starts_with("video/") {
        return Err(message(format!(
            "Not image or video media: {} ({mime})",
            path.display()
        )));
    }
    Ok(mime)
}
