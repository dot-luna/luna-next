use std::{
    fs,
    io::{self, Write},
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
};

use super::paths;
use crate::{Error, Result, io_error};

/// Snapshot exports and browser-owned source files before downloads or other slow preparation.
pub(super) struct File {
    path: PathBuf,
    original: Option<Vec<u8>>,
    mode: Option<u32>,
}

impl File {
    pub fn open(path: &Path) -> Result<Self> {
        let original = read(path)?;
        let mode = original
            .as_ref()
            .map(|_| {
                fs::metadata(path)
                    .map(|metadata| metadata.permissions().mode())
                    .map_err(|error| io_error("read Zen file permissions", path, error))
            })
            .transpose()?;
        Ok(Self {
            path: path.into(),
            original,
            mode,
        })
    }

    pub fn bytes(&self) -> Option<&[u8]> {
        self.original.as_deref()
    }

    pub fn check(&self) -> Result<()> {
        if read(&self.path)? != self.original {
            return Err(Error::Message(format!(
                "Zen configuration changed externally: {}",
                self.path.display()
            )));
        }
        if let Some(mode) = self.mode
            && fs::metadata(&self.path)
                .map_err(|error| io_error("check Zen file permissions", &self.path, error))?
                .permissions()
                .mode()
                != mode
        {
            return Err(Error::Message(format!(
                "Zen file permissions changed externally: {}",
                self.path.display()
            )));
        }
        Ok(())
    }

    pub fn publish(&self, contents: &[u8]) -> Result<()> {
        self.check()?;
        let mode = self.mode.map(|mode| mode & 0o777).unwrap_or(0o600);
        if self.original.as_deref() == Some(contents) {
            return Ok(());
        }
        let parent = self.path.parent().expect("absolute file path");
        fs::create_dir_all(parent)
            .map_err(|error| io_error("create Zen export directory", parent, error))?;
        paths::check(parent)?;
        let mut staged = tempfile::NamedTempFile::new_in(parent)
            .map_err(|error| io_error("stage Zen file", &self.path, error))?;
        staged
            .write_all(contents)
            .map_err(|error| io_error("write Zen file", &self.path, error))?;
        staged
            .as_file()
            .set_permissions(fs::Permissions::from_mode(mode))
            .map_err(|error| io_error("set Zen file permissions", &self.path, error))?;
        staged
            .as_file()
            .sync_all()
            .map_err(|error| io_error("sync Zen file", &self.path, error))?;
        self.check()?;
        staged
            .persist(&self.path)
            .map_err(|error| io_error("publish Zen file", &self.path, error.error))?;
        fs::File::open(parent)
            .and_then(|file| file.sync_all())
            .map_err(|error| io_error("sync Zen export directory", parent, error))?;
        Ok(())
    }
}

fn read(path: &Path) -> Result<Option<Vec<u8>>> {
    paths::check(path)?;
    match fs::symlink_metadata(path) {
        Ok(metadata) if !metadata.is_file() => {
            return Err(Error::Message(format!(
                "Zen configuration must be a regular file: {}",
                path.display()
            )));
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(io_error("inspect Zen file", path, error)),
    }
    fs::read(path)
        .map(Some)
        .map_err(|error| io_error("read Zen file", path, error))
}
