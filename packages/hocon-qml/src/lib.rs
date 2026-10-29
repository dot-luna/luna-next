//! Rust implementation of the read-only `LunaNext.Config` QML loader.
//!
//! The C++ adapter converts the returned JSON text into a JavaScript object.

use std::{fs, path::Path};

use luna_next_hocon::{Config, Error, Result};
use serde_json::Value;

#[cxx::bridge(namespace = "luna_next::config")]
mod ffi {
    extern "Rust" {
        fn load_as_json_with_schema(path: &str, schema_path: &str) -> Result<String>;
    }
}

/// Load a HOCON file and return compact resolved JSON for the JavaScript parser.
///
/// Missing files and parent directories are created by [`luna_next_hocon::Config::open`].
/// Parsing, include resolution, and filesystem errors propagate to C++ as
/// `rust::Error` exceptions.
pub fn load_as_json(path: &str) -> Result<String> {
    load_as_json_with_schema(path, "")
}

/// Load resolved HOCON, optionally validating it against a JSON Schema file.
/// An empty schema path skips validation. Schema files must already exist.
pub fn load_as_json_with_schema(path: &str, schema_path: &str) -> Result<String> {
    let schema = if schema_path.is_empty() {
        None
    } else {
        let source = fs::read_to_string(schema_path).map_err(|source| Error::Io {
            operation: "read schema",
            path: Path::new(schema_path).into(),
            source,
        })?;
        Some(
            serde_json::from_str::<Value>(&source).map_err(|error| Error::InvalidSchema {
                path: String::new(),
                message: format!("cannot parse '{schema_path}' as JSON: {error}"),
            })?,
        )
    };
    let config = Config::open(path)?;
    if let Some(schema) = schema {
        config.validate(&schema).map_err(|error| match error {
            Error::InvalidSchema { path, message } => Error::InvalidSchema {
                path,
                message: format!("'{schema_path}': {message}"),
            },
            error => error,
        })?;
    }
    Ok(serde_json::to_string(config.resolved()?)?)
}
