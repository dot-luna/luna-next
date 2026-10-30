//! Shared application operations for Luna's command line and desktop clients.

pub mod chromium;
mod config_io;
pub mod install;
pub mod keyring;
pub mod login;
pub mod menu;
pub mod polkit;
mod process;
pub mod theme;
pub mod wallpaper;
pub mod webapp;
pub mod zen;

use std::{
    io,
    path::{Path, PathBuf},
};

/// Shared operation errors, retaining HOCON diagnostics and filesystem context.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Message(String),
    #[error("cannot {operation} '{}': {source}", path.display())]
    Io {
        operation: &'static str,
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error(transparent)]
    Config(#[from] luna_next_hocon::Error),
    #[error("invalid JSON: {0}")]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

pub(crate) fn io_error(operation: &'static str, path: &Path, source: io::Error) -> Error {
    Error::Io {
        operation,
        path: path.into(),
        source,
    }
}
