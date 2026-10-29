//! Rust implementation of the read-only `LunaNext.Config` QML loader.
//!
//! The C++ adapter converts the returned JSON text into a JavaScript object.

#[cxx::bridge(namespace = "luna_next::config")]
mod ffi {
    extern "Rust" {
        fn load_as_json(path: &str) -> Result<String>;
    }
}

/// Load a HOCON file and return compact resolved JSON for the JavaScript parser.
///
/// Missing files and parent directories are created by [`luna_next_hocon::Config::open`].
/// Parsing, include resolution, and filesystem errors propagate to C++ as
/// `rust::Error` exceptions.
pub fn load_as_json(path: &str) -> luna_next_hocon::Result<String> {
    let config = luna_next_hocon::Config::open(path)?;
    Ok(serde_json::to_string(config.resolved()?)?)
}
