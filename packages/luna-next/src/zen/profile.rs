use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    os::{fd::AsRawFd, unix::fs::OpenOptionsExt},
    path::{Path, PathBuf},
};

use super::{Paths, files, paths};
use crate::{Error, Result, io_error};

pub(super) struct Target {
    pub directory: PathBuf,
    pub registry: Option<files::File>,
}

impl Target {
    pub fn resolve(paths: &Paths, directory: Option<&Path>) -> Result<Option<Self>> {
        if let Some(directory) = directory {
            return Ok(Some(Self {
                directory: paths::absolute(directory)?,
                registry: None,
            }));
        }
        let registry = files::File::open(&paths.profiles_dir.join("profiles.ini"))?;
        let Some(bytes) = registry.bytes() else {
            return Ok(None);
        };
        let text = std::str::from_utf8(bytes)
            .map_err(|_| Error::Message("Zen profiles.ini must contain UTF-8 text".into()))?;
        let sections = parse(text)?;
        let mut installed = BTreeSet::new();
        for (name, values) in &sections {
            if name.starts_with("Install")
                && let Some(value) = values.get("Default")
            {
                installed.insert(registry_path(&paths.profiles_dir, value, None)?);
            }
        }
        let selected = if !installed.is_empty() {
            unique(installed)?
        } else {
            let mut all = BTreeSet::new();
            let mut defaults = BTreeSet::new();
            for (name, values) in &sections {
                if !name.starts_with("Profile") {
                    continue;
                }
                let path = values.get("Path").ok_or_else(|| {
                    Error::Message(format!("Zen profiles.ini [{name}] has no Path"))
                })?;
                let relative = values.get("IsRelative").ok_or_else(|| {
                    Error::Message(format!("Zen profiles.ini [{name}] has no IsRelative"))
                })?;
                let path = registry_path(&paths.profiles_dir, path, Some(relative))?;
                all.insert(path.clone());
                if values.get("Default").is_some_and(|value| value == "1") {
                    defaults.insert(path);
                }
            }
            if !defaults.is_empty() {
                unique(defaults)?
            } else if all.is_empty() {
                return Ok(None);
            } else {
                unique(all)?
            }
        };
        Ok(Some(Self {
            directory: selected,
            registry: Some(registry),
        }))
    }

    pub fn preferences(&self) -> Result<files::File> {
        paths::check(&self.directory)?;
        if !self.directory.is_dir() {
            return Err(missing(&self.directory));
        }
        let preferences = files::File::open(&self.directory.join("prefs.js"))?;
        if preferences.bytes().is_none() {
            return Err(missing(&self.directory));
        }
        Ok(preferences)
    }

    pub fn check_registry(&self) -> Result<()> {
        self.registry.as_ref().map_or(Ok(()), files::File::check)
    }

    /// Firefox uses POSIX record locks here. A stale .parentlock is normal after exit.
    /// Keep a separate flock for Luna callers because POSIX locks are per process.
    pub fn lock(&self) -> Result<Lock> {
        let cooperative = open_lock(&self.directory.join(".luna-config.lock"))?;
        cooperative
            .try_lock()
            .map_err(|error| Error::Message(format!("Zen configuration is busy: {error}")))?;
        let browser = open_lock(&self.directory.join(".parentlock"))?;
        let mut record: libc::flock = unsafe { std::mem::zeroed() };
        record.l_type = libc::F_WRLCK as libc::c_short;
        record.l_whence = libc::SEEK_SET as libc::c_short;
        if unsafe { libc::fcntl(browser.as_raw_fd(), libc::F_SETLK, &record) } == -1 {
            let error = std::io::Error::last_os_error();
            return Err(Error::Message(format!(
                "Close Zen before configuring this profile ({}): {error}",
                self.directory.display()
            )));
        }
        Ok(Lock {
            _cooperative: cooperative,
            _browser: browser,
        })
    }
}

pub(super) struct Lock {
    _cooperative: fs::File,
    _browser: fs::File,
}

pub(super) fn missing(profile: &Path) -> Error {
    Error::Message(format!(
        "Zen profile does not exist: {}; open Zen once, close it, then run luna conf zen",
        profile.display()
    ))
}

fn open_lock(path: &Path) -> Result<fs::File> {
    paths::check(path)?;
    fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .map_err(|error| io_error("open Zen profile lock", path, error))
}

fn registry_path(root: &Path, value: &str, relative: Option<&String>) -> Result<PathBuf> {
    let path = Path::new(value);
    if value.is_empty() || value.chars().any(char::is_control) {
        return Err(Error::Message(
            "Zen profiles.ini contains an invalid profile path".into(),
        ));
    }
    let is_relative = match relative.map(String::as_str) {
        Some("1") => true,
        Some("0") => false,
        None => !path.is_absolute(),
        _ => return Err(Error::Message("Zen IsRelative must be 0 or 1".into())),
    };
    if is_relative == path.is_absolute() {
        return Err(Error::Message(
            "Zen profile path disagrees with IsRelative".into(),
        ));
    }
    paths::absolute(&if is_relative {
        root.join(path)
    } else {
        path.into()
    })
}

fn unique(paths: BTreeSet<PathBuf>) -> Result<PathBuf> {
    if paths.len() != 1 {
        return Err(Error::Message(
            "Zen has multiple candidate default profiles; select one with luna conf zen --profile PATH".into()
        ));
    }
    Ok(paths.into_iter().next().unwrap())
}

fn parse(text: &str) -> Result<BTreeMap<String, BTreeMap<String, String>>> {
    let mut sections = BTreeMap::<String, BTreeMap<String, String>>::new();
    let mut current = None;
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with([';', '#']) {
            continue;
        }
        if let Some(name) = line
            .strip_prefix('[')
            .and_then(|line| line.strip_suffix(']'))
        {
            if name.is_empty() || sections.contains_key(name) {
                return Err(Error::Message(
                    "Zen profiles.ini has an empty or duplicate section".into(),
                ));
            }
            sections.insert(name.into(), BTreeMap::new());
            current = Some(name.to_owned());
            continue;
        }
        let (Some(current), Some((key, value))) = (current.as_ref(), line.split_once('=')) else {
            return Err(Error::Message(
                "Zen profiles.ini has invalid INI syntax".into(),
            ));
        };
        if key.trim().is_empty()
            || sections
                .get_mut(current)
                .unwrap()
                .insert(key.trim().into(), value.trim().into())
                .is_some()
        {
            return Err(Error::Message(
                "Zen profiles.ini has an empty or duplicate key".into(),
            ));
        }
    }
    Ok(sections)
}
