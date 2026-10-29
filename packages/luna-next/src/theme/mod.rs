//! Declarative theme copies and resolved values shared by desktop clients.
//! Source files remain HOCON; defaults and derived colors are merged only in memory.

mod defaults;
mod mode;
mod paths;
mod store;
mod values;

pub use paths::Paths;

use std::{
    fs,
    path::{Path, PathBuf},
};

use luna_next_hocon::Config;
use serde::Serialize;
use serde_json::{Value, json};

use crate::{Error, Result, config_io, io_error};

#[derive(Debug, Serialize)]
/// An installed theme name with a marker for the saved selection.
pub struct ThemeEntry {
    pub name: String,
    pub current: bool,
}

/// Theme library and selection, independent of the command line and UI.
/// Mutations share an advisory lock; source edits require a new read or selection.
pub struct Themes {
    paths: Paths,
}

impl Themes {
    /// Select XDG paths without loading themes or changing desktop settings.
    pub fn from_env() -> Result<Self> {
        Self::new(Paths::from_env()?)
    }

    /// Use explicit nonempty paths. Relative paths resolve against the current directory.
    pub fn new(mut paths: Paths) -> Result<Self> {
        for path in [
            &mut paths.config_file,
            &mut paths.library_dir,
            &mut paths.wallpaper_dir,
        ] {
            if path.as_os_str().is_empty() {
                return Err(Error::Message("theme paths must not be empty".into()));
            }
            *path = std::path::absolute(&*path).map_err(|error| io_error("locate", path, error))?;
        }
        Ok(Self { paths })
    }

    pub fn config_file(&self) -> &Path {
        &self.paths.config_file
    }
    pub fn directory(&self) -> &Path {
        &self.paths.library_dir
    }

    /// Read the selected name. Creates a missing selection file; an unset name is null.
    pub fn current(&self) -> Result<Option<String>> {
        Ok(self
            .selection()?
            .get("theme.name")?
            .as_str()
            .map(str::to_owned))
    }

    /// Resolve the selected installed theme, or Tokyo Night defaults if none is selected.
    /// Missing keys return null; unknown variables and invalid source values are errors.
    pub fn get(&self, key: Option<&str>) -> Result<Value> {
        let value = if let Some(name) = self.current()? {
            values::resolve(&values::read(&self.path(&name)?)?, &name)?
        } else {
            values::resolve(&json!({}), "tokyo-night")?
        };
        values::lookup(value, key)
    }

    /// Resolve an installed theme without selecting it or changing desktop settings.
    pub fn inspect(&self, name: &str) -> Result<Value> {
        values::resolve(&values::read(&self.path(name)?)?, name)
    }

    /// Save selection and apply its system appearance preference. Does not reload apps
    /// or select a wallpaper. Application failures attempt exact source restoration,
    /// refusing to overwrite detected external edits.
    pub fn set(&self, name: &str) -> Result<Value> {
        let _lock = config_io::lock(&self.paths.config_file)?;
        let value = self.inspect(name)?;
        self.save_appearance(
            Some(name),
            value["colors"]["mode"].as_str().expect("validated mode"),
        )?;
        Ok(value)
    }

    /// Read a regular installed directory. Rejects symlink entries and invalid names.
    pub fn path(&self, name: &str) -> Result<PathBuf> {
        values::name(name)?;
        let path = self.paths.library_dir.join(name);
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| io_error("locate installed theme", &path, error))?;
        if !metadata.is_dir() {
            return Err(Error::Message(format!(
                "installed theme is not a regular directory: {}",
                path.display()
            )));
        }
        Ok(path)
    }

    /// Translate the active palette into Hyprland appearance settings. Personal config
    /// loaded afterward can override these; this call does not contact the compositor.
    pub fn hyprland(&self) -> Result<Value> {
        let theme = self.get(None)?;
        let appearance = &theme["appearance"];
        Ok(json!({
            "general": {
                "gaps_in": appearance["gaps"]["inner"],
                "gaps_out": appearance["gaps"]["outer"],
                "border_size": appearance["border_width"],
                "col": {"active_border": theme["colors"]["accent"], "inactive_border": theme["colors"]["muted"]}
            },
            "decoration": {
                "rounding": appearance["rounding"],
                "active_opacity": appearance["opacity"]["active"],
                "inactive_opacity": appearance["opacity"]["inactive"],
                "fullscreen_opacity": appearance["opacity"]["fullscreen"],
                "blur": appearance["blur"],
                "shadow": {
                    "enabled": appearance["shadow"]["enabled"],
                    "range": appearance["shadow"]["range"],
                    "render_power": appearance["shadow"]["falloff"],
                    "color": format!("{}aa", theme["colors"]["dark_background"].as_str().unwrap()),
                    "color_inactive": format!("{}66", theme["colors"]["darker_background"].as_str().unwrap())
                }
            }
        }))
    }

    fn selection(&self) -> Result<Config> {
        let config = Config::open(&self.paths.config_file)?;
        config.validate(&values::selection_schema()?)?;
        Ok(config)
    }
}
