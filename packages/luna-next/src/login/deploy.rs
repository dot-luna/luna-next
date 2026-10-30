//! Publish a prepared greeter without evaluating its QML or JavaScript as root.

use std::{
    ffi::CString,
    fs::{self, File, OpenOptions},
    io,
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::{ffi::OsStrExt, fs::OpenOptionsExt, fs::PermissionsExt},
    },
    path::{Component, Path, PathBuf},
};

use serde_json::Value;

use crate::{Error, Result, config_io, install, io_error};

/// The two managed exports. Other SDDM settings and themes are left untouched.
#[derive(Clone, Debug)]
pub struct DeploymentPaths {
    pub theme_dir: PathBuf,
    pub sddm_config_file: PathBuf,
}

impl Default for DeploymentPaths {
    fn default() -> Self {
        Self {
            theme_dir: "/usr/local/share/luna-next/login/active".into(),
            sddm_config_file: "/etc/sddm.conf.d/90-luna-next.conf".into(),
        }
    }
}

/// Publish to the fixed system destinations. Requires root; never invokes sudo
/// or restarts the display manager. A main SDDM configuration that overrides the
/// managed theme must be corrected before activation can take effect.
pub fn deploy_system(bundle: &Path) -> Result<PathBuf> {
    if unsafe { libc::geteuid() } != 0 {
        return Err(Error::Message(
            "Activating the login screen requires root privileges.".into(),
        ));
    }
    let paths = DeploymentPaths::default();
    validate_sddm_precedence(Path::new("/etc/sddm.conf"), &paths.sddm_config_file)?;
    deploy(bundle, &paths)
}

/// Copy and validate a self-contained Qt 6 SDDM bundle, then replace the theme
/// directory and its managed INI drop-in. Input links and special files, escaped
/// assets, and overlapping or symlinked destinations are rejected.
///
/// Callers choose explicit destinations and provide any required privileges.
/// Publication holds an advisory deployment lock. Each export is atomic, but a
/// later write, cleanup, or directory-sync failure can leave a partial deployment.
/// No backups are retained, and QML/JavaScript is never executed by this method.
pub fn deploy(bundle: &Path, paths: &DeploymentPaths) -> Result<PathBuf> {
    let source = open_directory(bundle)?;
    let identity = fs::canonicalize(descriptor_path(&source))
        .map_err(|error| io_error("locate login bundle", bundle, error))?;
    validate_destinations(&identity, paths)?;
    let config = sddm_config(&paths.theme_dir)?;

    // Handles opened with O_NOFOLLOW prevent a changing source tree from making
    // privileged copying follow a link between inspection and reading.
    let staging = tempfile::Builder::new()
        .prefix("luna-login-deploy-")
        .tempdir_in("/tmp")
        .map_err(|error| io_error("stage login deployment", bundle, error))?;
    if staging.path().starts_with(&identity) {
        return Err(Error::Message(
            "Login bundle overlaps deployment staging.".into(),
        ));
    }
    let snapshot = staging.path().join("theme");
    fs::create_dir(&snapshot).map_err(|error| io_error("stage login theme", &snapshot, error))?;
    copy_snapshot(&source, &snapshot)?;
    set_mode(&snapshot, 0o755)?;
    validate_bundle(&snapshot)?;
    let staged_config = staging.path().join("sddm.conf");
    fs::write(&staged_config, config)
        .map_err(|error| io_error("stage SDDM configuration", &staged_config, error))?;
    set_mode(&staged_config, 0o644)?;

    create_parents(paths.theme_dir.parent().unwrap())?;
    create_parents(paths.sddm_config_file.parent().unwrap())?;
    let _lock = config_io::lock(&paths.sddm_config_file)?;
    // Recheck after taking the lock; cooperating publishers cannot change these
    // paths between this check and both exports completing.
    validate_destinations(&identity, paths)?;
    install::replace(&snapshot, &paths.theme_dir, staging.path())?;
    install::replace(&staged_config, &paths.sddm_config_file, staging.path())?;
    Ok(paths.theme_dir.clone())
}

fn open_directory(path: &Path) -> Result<File> {
    OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .map_err(|error| io_error("open login bundle directory", path, error))
}

fn descriptor_path(file: &File) -> PathBuf {
    PathBuf::from(format!("/proc/self/fd/{}", file.as_raw_fd()))
}

fn copy_snapshot(source: &File, destination: &Path) -> Result<()> {
    let directory = descriptor_path(source);
    for entry in fs::read_dir(&directory)
        .map_err(|error| io_error("read login bundle", &directory, error))?
    {
        let entry = entry.map_err(|error| io_error("read login bundle", &directory, error))?;
        let name = entry.file_name();
        let target = destination.join(&name);
        let name = CString::new(name.as_bytes())
            .map_err(|_| Error::Message("Login bundle filename contains a NUL byte.".into()))?;
        let descriptor = unsafe {
            libc::openat(
                source.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
            )
        };
        if descriptor < 0 {
            return Err(io_error(
                "open login bundle entry without following links",
                &target,
                io::Error::last_os_error(),
            ));
        }
        let mut file = unsafe { File::from_raw_fd(descriptor) };
        let metadata = file
            .metadata()
            .map_err(|error| io_error("inspect login bundle entry", &target, error))?;
        if metadata.is_dir() {
            fs::create_dir(&target)
                .map_err(|error| io_error("stage login directory", &target, error))?;
            copy_snapshot(&file, &target)?;
            set_mode(&target, 0o755)?;
        } else if metadata.is_file() {
            let mut output = File::create(&target)
                .map_err(|error| io_error("stage login file", &target, error))?;
            io::copy(&mut file, &mut output)
                .map_err(|error| io_error("copy login bundle file", &target, error))?;
            set_mode(&target, 0o644)?;
        } else {
            return Err(Error::Message(format!(
                "Login bundle entries must be regular files or directories: {}",
                target.display()
            )));
        }
    }
    Ok(())
}

fn validate_bundle(root: &Path) -> Result<()> {
    for relative in [
        "Main.qml",
        "metadata.desktop",
        "Settings.js",
        "screen/Screen.qml",
    ] {
        let path = root.join(relative);
        if !path.is_file() {
            return Err(Error::Message(format!(
                "Login bundle is missing required file: {relative}"
            )));
        }
    }
    let metadata = fs::read_to_string(root.join("metadata.desktop"))
        .map_err(|error| io_error("read login metadata", root, error))?;
    for (key, expected) in [
        ("MainScript", "Main.qml"),
        ("QtVersion", "6"),
        ("Theme-API", "2.0"),
    ] {
        let values = ini_values(&metadata, "SddmGreeterTheme", key);
        if values.len() != 1 || values[0] != expected {
            return Err(Error::Message(format!(
                "Login metadata requires [SddmGreeterTheme] {key}={expected}."
            )));
        }
    }
    let settings_path = root.join("Settings.js");
    let script = fs::read_to_string(&settings_path)
        .map_err(|error| io_error("read login settings", &settings_path, error))?;
    let json = script
        .strip_prefix(".pragma library\nvar values = ")
        .and_then(|value| value.trim_end().strip_suffix(';'))
        .ok_or_else(|| {
            Error::Message("Login Settings.js must contain generated JSON only.".into())
        })?;
    let settings: Value = serde_json::from_str(json)?;
    if !settings.is_object() {
        return Err(Error::Message(
            "Login settings must be a JSON object.".into(),
        ));
    }
    validate_runtime_references(&settings)?;
    if let Some(source) = settings.pointer("/wallpaper/source") {
        let source = source.as_str().ok_or_else(|| {
            Error::Message("Login wallpaper.source must be a relative filename.".into())
        })?;
        if !source.is_empty() {
            validate_asset(root, source)?;
        }
    }
    Ok(())
}

fn validate_runtime_references(value: &Value) -> Result<()> {
    match value {
        Value::String(value)
            if [
                "/home/",
                "/run/user/",
                "$HOME",
                "${HOME}",
                "$XDG_",
                "${XDG_",
            ]
            .iter()
            .any(|reference| value.contains(reference)) =>
        {
            Err(Error::Message(
                "Login settings cannot refer to a user's home or session environment.".into(),
            ))
        }
        Value::Array(values) => {
            for value in values {
                validate_runtime_references(value)?;
            }
            Ok(())
        }
        Value::Object(values) => {
            for value in values.values() {
                validate_runtime_references(value)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

fn validate_asset(root: &Path, value: &str) -> Result<()> {
    let path = Path::new(value);
    if value.is_empty()
        || value.chars().any(char::is_control)
        || value.contains([':', '\\', '$', '~', '%', '?', '#'])
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
        || !root.join(path).is_file()
    {
        return Err(Error::Message(format!(
            "Login asset must be a file inside its bundle: {value}"
        )));
    }
    Ok(())
}

fn validate_destinations(source: &Path, paths: &DeploymentPaths) -> Result<()> {
    for target in [&paths.theme_dir, &paths.sddm_config_file] {
        if !target.is_absolute()
            || target.file_name().is_none()
            || target
                .components()
                .any(|part| matches!(part, Component::ParentDir | Component::CurDir))
        {
            return Err(Error::Message(format!(
                "Login deployment destination must be an absolute, normalized path: {}",
                target.display()
            )));
        }
        if source.starts_with(target) || target.starts_with(source) {
            return Err(Error::Message(format!(
                "Login deployment destination overlaps its bundle: {}",
                target.display()
            )));
        }
        let mut current = PathBuf::new();
        for part in target.components() {
            current.push(part.as_os_str());
            match fs::symlink_metadata(&current) {
                Ok(metadata) if metadata.is_symlink() => {
                    return Err(Error::Message(format!(
                        "Login deployment destinations cannot contain symlinks: {}",
                        current.display()
                    )));
                }
                Ok(metadata)
                    if !metadata.is_dir() && !(current == *target && metadata.is_file()) =>
                {
                    return Err(Error::Message(format!(
                        "Unsupported login deployment destination: {}",
                        current.display()
                    )));
                }
                Ok(_) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(io_error("inspect login destination", &current, error)),
            }
        }
    }
    if paths.theme_dir.starts_with(&paths.sddm_config_file)
        || paths.sddm_config_file.starts_with(&paths.theme_dir)
    {
        return Err(Error::Message(
            "Login deployment destinations overlap.".into(),
        ));
    }
    Ok(())
}

fn sddm_config(theme: &Path) -> Result<String> {
    let parent = theme.parent().and_then(Path::to_str);
    let name = theme.file_name().and_then(|name| name.to_str());
    let (Some(parent), Some(name)) = (parent, name) else {
        return Err(Error::Message(
            "SDDM theme path must be valid UTF-8.".into(),
        ));
    };
    if [parent, name].iter().any(|value| {
        value.chars().any(char::is_control)
            || value.contains(['\\', '"', ';', '#'])
            || value.trim() != *value
    }) {
        return Err(Error::Message(
            "SDDM theme path contains unsupported INI characters.".into(),
        ));
    }
    Ok(format!("[Theme]\nThemeDir={parent}\nCurrent={name}\n"))
}

fn create_parents(path: &Path) -> Result<()> {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        match fs::create_dir(&current) {
            Ok(()) => set_mode(&current, 0o755)?,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => {
                return Err(io_error(
                    "create login deployment directory",
                    &current,
                    error,
                ));
            }
        }
    }
    Ok(())
}

fn set_mode(path: &Path, mode: u32) -> Result<()> {
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
        .map_err(|error| io_error("set login deployment permissions", path, error))
}

fn has_theme_override(contents: &str) -> bool {
    ["ThemeDir", "Current"]
        .iter()
        .any(|key| !ini_values(contents, "Theme", key).is_empty())
}

fn validate_sddm_precedence(main_config: &Path, managed_config: &Path) -> Result<()> {
    let mut higher_priority = vec![main_config.to_path_buf()];
    let directory = managed_config.parent().unwrap();
    match fs::read_dir(directory) {
        Ok(entries) => {
            for entry in entries {
                let entry = entry.map_err(|error| {
                    io_error("read SDDM configuration directory", directory, error)
                })?;
                let name = entry.file_name();
                // SDDM loads every visible file, including names without .conf.
                if !name.as_bytes().starts_with(b".")
                    && name.as_os_str() > managed_config.file_name().unwrap()
                    && entry.path().is_file()
                {
                    higher_priority.push(entry.path());
                }
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(io_error(
                "read SDDM configuration directory",
                directory,
                error,
            ));
        }
    }
    for path in higher_priority {
        match fs::read_to_string(&path) {
            Ok(contents) if has_theme_override(&contents) => {
                return Err(Error::Message(format!(
                    "{} overrides ThemeDir or Current; remove those theme settings before activating Luna login.",
                    path.display()
                )));
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(io_error("read SDDM configuration", &path, error)),
        }
    }
    Ok(())
}

fn ini_values<'a>(contents: &'a str, group: &str, key: &str) -> Vec<&'a str> {
    let mut section = "";
    let mut values = Vec::new();
    for line in contents
        .lines()
        .map(|line| line.split('#').next().unwrap_or_default().trim())
    {
        if line.starts_with(['#', ';']) || line.is_empty() {
            continue;
        }
        if let Some(name) = line
            .strip_prefix('[')
            .and_then(|line| line.strip_suffix(']'))
        {
            section = name.trim();
        } else if section == group
            && let Some((name, value)) = line.split_once('=')
            && name.trim() == key
        {
            values.push(value.trim());
        }
    }
    values
}

#[cfg(test)]
#[path = "../../tests/unit/login_deploy.rs"]
mod tests;
