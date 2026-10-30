use std::{
    ffi::CString,
    fs, io,
    os::unix::ffi::OsStrExt,
    path::{Component, Path, PathBuf},
};

use crate::{Error, Result, io_error};

pub(super) fn relative(path: &Path) -> Result<()> {
    if path.as_os_str().is_empty()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(Error::Message(format!(
            "App configuration paths must be relative without '..': {}",
            path.display()
        )));
    }
    Ok(())
}

pub(super) fn validate_destinations(
    targets: &[(PathBuf, Option<PathBuf>)],
    repository: &Path,
    apps: &Path,
) -> Result<()> {
    let repository = fs::canonicalize(repository)
        .map_err(|error| io_error("locate configuration repository", repository, error))?;
    let mut destinations = Vec::new();
    for (target, defaults) in targets {
        for path in std::iter::once(target).chain(defaults.iter()) {
            // Resolve parent links, but replace the final link itself instead of its referent.
            let parent = path.parent().ok_or_else(|| {
                Error::Message(format!(
                    "Invalid configuration destination: {}",
                    path.display()
                ))
            })?;
            let destination =
                destination_identity(parent)?.join(path.file_name().ok_or_else(|| {
                    Error::Message(format!(
                        "Invalid configuration destination: {}",
                        path.display()
                    ))
                })?);
            if destination.starts_with(&repository)
                || repository.starts_with(&destination)
                || destination.starts_with(apps)
                || apps.starts_with(&destination)
            {
                return Err(Error::Message(format!(
                    "Configuration destination overlaps its source tree: {}",
                    path.display()
                )));
            }
            if destinations.iter().any(|previous: &PathBuf| {
                destination.starts_with(previous) || previous.starts_with(&destination)
            }) {
                return Err(Error::Message(format!(
                    "Configuration destinations overlap: {}",
                    path.display()
                )));
            }
            match fs::symlink_metadata(path) {
                Ok(metadata)
                    if metadata.is_file() || metadata.is_dir() || metadata.is_symlink() => {}
                Ok(_) => {
                    return Err(Error::Message(format!(
                        "Unsupported configuration destination: {}",
                        path.display()
                    )));
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(io_error("inspect configuration destination", path, error));
                }
            }
            destinations.push(destination);
        }
        if let Some(defaults) = defaults
            && defaults.to_str().is_none()
        {
            return Err(Error::Message(format!(
                "Configuration defaults path must be valid UTF-8: {}",
                defaults.display()
            )));
        }
    }
    Ok(())
}

fn destination_identity(path: &Path) -> Result<PathBuf> {
    let mut ancestor = path;
    let mut suffix: Vec<Component<'_>> = Vec::new();
    loop {
        match fs::canonicalize(ancestor) {
            Ok(mut resolved) => {
                for component in suffix.into_iter().rev() {
                    if component == Component::ParentDir {
                        resolved.pop();
                    } else {
                        resolved.push(component.as_os_str());
                    }
                }
                return Ok(resolved);
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                if fs::symlink_metadata(ancestor).is_ok() {
                    return Err(io_error("locate configuration destination", path, error));
                }
                if let (Some(component), Some(parent)) =
                    (ancestor.components().next_back(), ancestor.parent())
                {
                    suffix.push(component);
                    ancestor = parent;
                } else {
                    return Err(io_error("locate configuration destination", path, error));
                }
            }
            Err(error) => return Err(io_error("locate configuration destination", path, error)),
        }
    }
}

pub(super) fn validate_source(path: &Path, root: &Path) -> Result<PathBuf> {
    let resolved = fs::canonicalize(path)
        .map_err(|error| io_error("locate generated configuration", path, error))?;
    if !resolved.starts_with(root) || (!resolved.is_file() && !resolved.is_dir()) {
        return Err(Error::Message(format!(
            "Configuration export must be a file or directory inside staging: {}",
            path.display()
        )));
    }
    if resolved.is_dir() {
        for entry in fs::read_dir(&resolved)
            .map_err(|error| io_error("read generated configuration directory", &resolved, error))?
        {
            let entry = entry.map_err(|error| {
                io_error("read generated configuration directory", &resolved, error)
            })?;
            let metadata = entry.file_type().map_err(|error| {
                io_error("inspect generated configuration", &entry.path(), error)
            })?;
            if metadata.is_symlink() && entry.path().is_dir() {
                return Err(Error::Message(format!(
                    "Configuration directory links are unsupported: {}",
                    entry.path().display()
                )));
            }
            validate_source(&entry.path(), root)?;
        }
    }
    Ok(resolved)
}

pub(crate) fn copy_tree(source: &Path, destination: &Path, root: &Path) -> Result<()> {
    for entry in fs::read_dir(source)
        .map_err(|error| io_error("read app configuration source", source, error))?
    {
        let entry =
            entry.map_err(|error| io_error("read app configuration source", source, error))?;
        let path = entry.path();
        let target = destination.join(entry.file_name());
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| io_error("inspect app configuration source", &path, error))?;
        if metadata.is_dir() {
            fs::create_dir(&target)
                .map_err(|error| io_error("stage app configuration directory", &target, error))?;
            copy_tree(&path, &target, root)?;
            fs::set_permissions(&target, metadata.permissions())
                .map_err(|error| io_error("copy directory permissions", &target, error))?;
        } else {
            let resolved = fs::canonicalize(&path)
                .map_err(|error| io_error("locate app configuration source", &path, error))?;
            if !resolved.starts_with(root) || !resolved.is_file() {
                return Err(Error::Message(format!(
                    "App configuration source must be a file inside its config tree: {}",
                    path.display()
                )));
            }
            fs::copy(&resolved, &target)
                .map_err(|error| io_error("stage app configuration file", &path, error))?;
        }
    }
    Ok(())
}

// Stage on the destination filesystem so publication can rename whole exports.
// Each export swaps atomically; later cleanup or sync failures do not undo that swap.
pub(crate) fn replace(source: &Path, target: &Path, root: &Path) -> Result<()> {
    let parent = target.parent().unwrap();
    fs::create_dir_all(parent)
        .map_err(|error| io_error("create configuration directory", parent, error))?;
    let staging = tempfile::tempdir_in(parent)
        .map_err(|error| io_error("stage configuration export", target, error))?;
    let replacement = staging.path().join("export");
    if source.is_dir() {
        fs::create_dir(&replacement)
            .map_err(|error| io_error("stage configuration directory", target, error))?;
        copy_tree(source, &replacement, root)?;
        let permissions = fs::metadata(source)
            .map_err(|error| io_error("read export permissions", source, error))?
            .permissions();
        fs::set_permissions(&replacement, permissions)
            .map_err(|error| io_error("copy directory permissions", &replacement, error))?;
    } else {
        fs::copy(source, &replacement)
            .map_err(|error| io_error("copy configuration export", target, error))?;
    }
    sync_tree(&replacement)?;
    match fs::rename(&replacement, target) {
        Ok(()) => {}
        Err(error) if fs::symlink_metadata(target).is_err() => {
            return Err(io_error("install configuration export", target, error));
        }
        Err(_) => exchange(&replacement, target)?,
    }
    staging
        .close()
        .map_err(|error| io_error("remove replaced configuration", target, error))?;
    fs::File::open(parent)
        .and_then(|file| file.sync_all())
        .map_err(|error| io_error("flush configuration directory", parent, error))?;
    Ok(())
}

fn sync_tree(path: &Path) -> Result<()> {
    if path.is_dir() {
        for entry in fs::read_dir(path)
            .map_err(|error| io_error("read staged configuration", path, error))?
        {
            let entry =
                entry.map_err(|error| io_error("read staged configuration", path, error))?;
            sync_tree(&entry.path())?;
        }
    }
    fs::File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(|error| io_error("flush configuration export", path, error))
}

fn exchange(staged: &Path, target: &Path) -> Result<()> {
    let from = CString::new(staged.as_os_str().as_bytes())
        .map_err(|_| Error::Message("Configuration staging path contains a NUL byte.".into()))?;
    let to = CString::new(target.as_os_str().as_bytes())
        .map_err(|_| Error::Message("Configuration destination contains a NUL byte.".into()))?;
    // Swap whole trees without deleting the installed config before the replacement succeeds.
    // The temporary staging directory then removes the previous file, folder, or link.
    if unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            from.as_ptr(),
            libc::AT_FDCWD,
            to.as_ptr(),
            libc::RENAME_EXCHANGE,
        )
    } != 0
    {
        return Err(io_error(
            "replace configuration export",
            target,
            io::Error::last_os_error(),
        ));
    }
    Ok(())
}
