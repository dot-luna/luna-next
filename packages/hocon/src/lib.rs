#![doc = include_str!("../README.md")]
#![forbid(unsafe_code)]

mod edit;
mod load;
mod storage;
mod syntax;

use std::io;
use std::path::{Path, PathBuf};

use serde_json::Value;
use thiserror::Error;

/// Errors retain the operation, entry-point path, and underlying cause.
#[derive(Debug, Error)]
pub enum Error {
    #[error("cannot {operation} '{}': {source}", path.display())]
    Io {
        operation: &'static str,
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("cannot parse or resolve '{}': {source}", path.display())]
    Parse {
        path: PathBuf,
        #[source]
        source: hocon_rs::Error,
    },
    #[error("invalid dot-separated configuration path '{path}' (segments must be nonempty)")]
    InvalidPath { path: String },
    #[error("configuration file '{}' changed; open it again before editing", path.display())]
    Conflict { path: PathBuf },
    #[error("cannot safely edit configuration: {message}")]
    Edit { message: String },
    #[error("cannot encode JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[cfg(feature = "schema")]
    #[error("invalid JSON schema at '{path}': {message}")]
    InvalidSchema { path: String, message: String },
    #[cfg(feature = "schema")]
    #[error("configuration at '{path}' does not match schema: {message}")]
    Validation { path: String, message: String },
}

pub type Result<T> = std::result::Result<T, Error>;

/// A HOCON configuration file with path-based access, editing, and resolution.
///
/// Reads use the values loaded on open. Successful edits save immediately and
/// update those values.
#[derive(Debug)]
pub struct Config {
    path: PathBuf,
    source: String,
    resolved: Value,
}

impl Config {
    /// Load a HOCON entry point, resolving includes relative to each source file.
    /// Creates an empty file and missing parent directories when needed.
    /// Existing files are preserved and symbolic links are followed.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        storage::open(path.as_ref())
    }

    /// Retrieve an effective value, returning JSON null when the key is absent.
    /// Missing values and explicit JSON null both return `Ok(&Value::Null)`.
    /// Paths address object keys, with dots separating nonempty segments.
    pub fn get(&self, path: &str) -> Result<&Value> {
        validate_path(path)?;
        Ok(path
            .split('.')
            .try_fold(&self.resolved, |value, key| value.as_object()?.get(key))
            .unwrap_or(&Value::Null))
    }

    /// Set a value in the opened file, save it, and refresh resolved values.
    /// Creates a missing file and its parent directories. If the opened file was
    /// deleted, the new file contains only this setting.
    /// Objects follow HOCON's merge semantics when combined with included values.
    /// Ambiguous source edits return [`Error::Edit`] without saving.
    pub fn set(&mut self, path: &str, value: Value) -> Result<()> {
        self.modify(path, Some(&value))
    }

    /// Remove a value's definitions from the opened file, then resolve again.
    /// Included values at that path can become visible after removal.
    /// A path with no definition in the opened file is a no-op.
    /// A missing file is left absent.
    pub fn unset(&mut self, path: &str) -> Result<()> {
        self.modify(path, None)
    }

    /// Borrow the full effective configuration as a JSON-compatible value.
    pub fn resolved(&self) -> Result<&Value> {
        Ok(&self.resolved)
    }

    /// Encode the effective configuration as pretty JSON text, without saving it.
    pub fn to_json(&self) -> Result<String> {
        Ok(serde_json::to_string_pretty(&self.resolved)?)
    }

    /// Borrow the exact loaded source, including comments and includes.
    pub fn source(&self) -> &str {
        &self.source
    }

    /// Set several dot-separated paths in a single atomic save.
    /// No values are saved if any path or source edit fails.
    pub fn set_many(&mut self, values: &serde_json::Map<String, Value>) -> Result<()> {
        let changes: Vec<_> = values
            .iter()
            .map(|(path, value)| (path.as_str(), Some(value)))
            .collect();
        self.modify_many(&changes, |_| Ok(()))
    }

    /// Set several paths atomically, validating the final resolved configuration
    /// against a JSON Schema before saving. Requires the `schema` feature.
    #[cfg(feature = "schema")]
    pub fn set_many_validated(
        &mut self,
        values: &serde_json::Map<String, Value>,
        schema: &Value,
    ) -> Result<()> {
        let changes: Vec<_> = values
            .iter()
            .map(|(path, value)| (path.as_str(), Some(value)))
            .collect();
        self.modify_many(&changes, |value| validate_value(value, schema))
    }

    /// Validate the loaded, resolved configuration against a JSON Schema.
    /// Requires the `schema` feature. Does not change values or files, apply
    /// schema defaults, or retrieve external schema references.
    /// Reports the first failure with its JSON Pointer (`""` means the root).
    #[cfg(feature = "schema")]
    pub fn validate(&self, schema: &Value) -> Result<()> {
        validate_value(&self.resolved, schema)
    }

    fn modify(&mut self, path: &str, value: Option<&Value>) -> Result<()> {
        self.modify_many(&[(path, value)], |_| Ok(()))
    }
}

/// Validate a JSON-compatible value without changing it or retrieving references.
#[cfg(feature = "schema")]
pub fn validate_value(value: &Value, schema: &Value) -> Result<()> {
    let validator = jsonschema::options()
        .offline()
        .build(schema)
        .map_err(|error| Error::InvalidSchema {
            path: error.instance_path().to_string(),
            message: error.to_string(),
        })?;
    validator
        .validate(value)
        .map_err(|error| Error::Validation {
            path: error.instance_path().to_string(),
            message: error.to_string(),
        })
}

fn validate_path(path: &str) -> Result<()> {
    if path.split('.').any(str::is_empty) {
        return Err(Error::InvalidPath { path: path.into() });
    }
    Ok(())
}
