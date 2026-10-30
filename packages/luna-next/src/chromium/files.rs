use std::{
    fs,
    io::{self, Write},
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
};

use serde_json::Value;

use super::paths;
use crate::{Error, Result, io_error};

/// Retain the original source until publication so non-cooperating editors are detected.
pub(super) struct File {
    path: PathBuf,
    original: Option<Vec<u8>>,
    permissions: Option<u32>,
    staged: Option<tempfile::NamedTempFile>,
}

impl File {
    pub fn open(path: &Path) -> Result<Self> {
        paths::check(path)?;
        let original = read(path)?;
        let permissions = original
            .as_ref()
            .map(|_| {
                fs::metadata(path)
                    .map(|metadata| metadata.permissions().mode())
                    .map_err(|error| io_error("read Chromium file permissions", path, error))
            })
            .transpose()?;
        Ok(Self {
            path: path.into(),
            original,
            permissions,
            staged: None,
        })
    }

    pub fn json(&self) -> Result<Value> {
        let value = match &self.original {
            Some(bytes) => serde_json::from_slice(bytes)?,
            None => serde_json::json!({}),
        };
        if !value.is_object() {
            return Err(Error::Message(format!(
                "Chromium settings must be a JSON object: {}",
                self.path.display()
            )));
        }
        Ok(value)
    }

    pub fn original(&self) -> Option<&[u8]> {
        self.original.as_deref()
    }

    pub fn check(&self) -> Result<()> {
        paths::check(&self.path)?;
        if read(&self.path)? != self.original {
            return Err(Error::Message(format!(
                "Chromium configuration changed externally: {}",
                self.path.display()
            )));
        }
        if let Some(mode) = self.permissions
            && fs::metadata(&self.path)
                .map_err(|error| io_error("check Chromium permissions", &self.path, error))?
                .permissions()
                .mode()
                != mode
        {
            return Err(Error::Message(format!(
                "Chromium file permissions changed externally: {}",
                self.path.display()
            )));
        }
        Ok(())
    }

    pub fn stage(&mut self, bytes: &[u8], mode: u32) -> Result<()> {
        if self.original.as_deref() == Some(bytes)
            && self
                .permissions
                .is_some_and(|previous| previous & 0o777 == mode)
        {
            return Ok(());
        }
        self.check()?;
        let parent = self.path.parent().expect("absolute file path");
        fs::create_dir_all(parent)
            .map_err(|error| io_error("create Chromium file directory", parent, error))?;
        let mut staged = tempfile::NamedTempFile::new_in(parent)
            .map_err(|error| io_error("stage Chromium file", &self.path, error))?;
        staged
            .write_all(bytes)
            .map_err(|error| io_error("write Chromium file", &self.path, error))?;
        staged
            .as_file()
            .set_permissions(fs::Permissions::from_mode(mode))
            .map_err(|error| io_error("set Chromium file permissions", &self.path, error))?;
        staged
            .as_file()
            .sync_all()
            .map_err(|error| io_error("sync Chromium file", &self.path, error))?;
        self.staged = Some(staged);
        Ok(())
    }

    pub fn mode(&self, fallback: u32) -> u32 {
        self.permissions
            .map(|mode| mode & 0o777)
            .unwrap_or(fallback)
    }

    pub fn publish(&mut self) -> Result<()> {
        self.check()?;
        if let Some(staged) = self.staged.take() {
            staged
                .persist(&self.path)
                .map_err(|error| io_error("publish Chromium file", &self.path, error.error))?;
            fs::File::open(self.path.parent().unwrap())
                .and_then(|file| file.sync_all())
                .map_err(|error| io_error("sync Chromium file directory", &self.path, error))?;
        }
        Ok(())
    }
}

fn read(path: &Path) -> Result<Option<Vec<u8>>> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if !metadata.is_file() => {
            return Err(Error::Message(format!(
                "Chromium settings must be regular files: {}",
                path.display()
            )));
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(io_error("inspect Chromium file", path, error)),
    }
    fs::read(path)
        .map(Some)
        .map_err(|error| io_error("read Chromium file", path, error))
}
