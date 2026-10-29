use crate::{Error, Result, io_error};
use std::{fs, io::Write, path::Path};

/// Lock the canonical config target until the returned file is dropped.
/// This coordinates API clients; editors that ignore the advisory lock can still write.
pub(crate) fn lock(config_file: &Path) -> Result<fs::File> {
    let canonical = match fs::canonicalize(config_file) {
        Ok(path) => path,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let parent = config_file.parent().expect("absolute configuration path");
            fs::create_dir_all(parent)
                .map_err(|error| io_error("create configuration directory", parent, error))?;
            fs::canonicalize(parent)
                .map_err(|error| io_error("locate", parent, error))?
                .join(config_file.file_name().expect("configuration filename"))
        }
        Err(error) => return Err(io_error("locate", config_file, error)),
    };
    let name = canonical.file_name().unwrap_or_default().to_string_lossy();
    let lock_path = canonical.with_file_name(format!(".{name}.lock"));
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&lock_path)
        .map_err(|error| io_error("open lock for", &canonical, error))?;
    file.try_lock()
        .map_err(|error| Error::Message(format!("configuration is busy: {error}")))?;
    // Keep the lock path so future callers lock the same inode as existing holders.
    Ok(file)
}

/// Restore exact bytes and permissions using optimistic source checks before replacement.
/// A detected external edit prevents restoration rather than overwriting the editor's work.
pub(crate) fn restore(
    path: &Path,
    expected: &str,
    original: &str,
    permissions: fs::Permissions,
) -> Result<()> {
    let current =
        fs::read_to_string(path).map_err(|error| io_error("read before restoring", path, error))?;
    if current != expected {
        return Err(Error::Message(
            "configuration changed externally; leaving it untouched".into(),
        ));
    }
    let parent = path.parent().unwrap();
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| io_error("stage restored configuration beside", path, error))?;
    temporary
        .write_all(original.as_bytes())
        .map_err(|error| io_error("restore", path, error))?;
    temporary
        .as_file()
        .set_permissions(permissions)
        .map_err(|error| io_error("restore permissions of", path, error))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| io_error("sync restored configuration", path, error))?;
    // Check again after staging; external writers are not required to take our lock.
    if fs::read_to_string(path).map_err(|error| io_error("check before restoring", path, error))?
        != expected
    {
        return Err(Error::Message(
            "configuration changed externally; leaving it untouched".into(),
        ));
    }
    temporary
        .persist(path)
        .map_err(|error| io_error("restore", path, error.error))?;
    fs::File::open(parent)
        .and_then(|file| file.sync_all())
        .map_err(|error| io_error("sync directory after restoring", path, error))?;
    Ok(())
}
