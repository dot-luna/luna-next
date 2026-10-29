mod persistence;
mod values;

use super::{Status, Wallpaper};
use crate::{Error, Result, io_error};
use luna_next_hocon::Config;
use serde_json::{Map, Value};
use std::{fs, path::PathBuf};
use values::{effective, flatten, merge, schema};

impl Wallpaper {
    pub fn get_config(&self, key: Option<&str>) -> Result<Value> {
        let config = Config::open(&self.paths.config_file)?;
        let resolved = effective(config.resolved()?);
        luna_next_hocon::validate_value(&resolved, &schema()?)?;
        match key {
            None => Ok(resolved),
            Some(key) => {
                if key.split('.').any(str::is_empty) {
                    return Err(Error::Message(
                        "configuration keys use nonempty dot-separated segments".into(),
                    ));
                }
                Ok(key
                    .split('.')
                    .try_fold(&resolved, |value, key| value.as_object()?.get(key))
                    .cloned()
                    .unwrap_or(Value::Null))
            }
        }
    }

    /// Validate, save all changes together, and apply them to the renderer.
    /// Failed application restores the exact previous source when still current.
    pub fn update_config(&self, changes: Value) -> Result<Value> {
        if !changes.is_object() {
            return Err(Error::Message(
                "configuration changes must be a JSON object".into(),
            ));
        }
        let _lock = self.lock_config()?;
        self.update_locked(&changes)
    }

    pub(super) fn update_locked(&self, changes: &Value) -> Result<Value> {
        let mut config = Config::open(&self.paths.config_file)?;
        let mut candidate = config.resolved()?.clone();
        merge(&mut candidate, changes);
        let schema = schema()?;
        luna_next_hocon::validate_value(&effective(&candidate), &schema)?;
        let mut values = Map::new();
        flatten(changes, "", &mut values)?;
        if values.is_empty() {
            let original = effective(config.resolved()?);
            luna_next_hocon::validate_value(&original, &schema)?;
            return Ok(original);
        }
        let original = config.source().to_owned();
        let canonical = fs::canonicalize(&self.paths.config_file)
            .map_err(|error| io_error("locate", &self.paths.config_file, error))?;
        let permissions = fs::metadata(&canonical)
            .map_err(|error| io_error("read permissions of", &canonical, error))?
            .permissions();
        let was_running = self.runtime.status()? != Status::Stopped;
        config.set_many_validated(&values, &schema)?;
        let result = effective(config.resolved()?);
        if config.source() == original {
            return Ok(result);
        }
        if let Err(apply_error) = self.runtime.restart() {
            if let Err(rollback_error) =
                persistence::restore(&canonical, config.source(), &original, permissions)
            {
                return Err(Error::Message(format!(
                    "{apply_error}; could not restore configuration: {rollback_error}"
                )));
            }
            let recovery = if was_running {
                self.runtime.restart()
            } else {
                self.runtime.stop()
            };
            return Err(Error::Message(match recovery {
                Ok(_) => format!("{apply_error}; previous configuration restored"),
                Err(error) => format!(
                    "{apply_error}; previous configuration restored; renderer recovery failed: {error}"
                ),
            }));
        }
        Ok(result)
    }

    pub(super) fn current(&self) -> Result<Option<PathBuf>> {
        let value = self.get_config(Some("wallpaper.source"))?;
        let path = value.as_str().unwrap_or("");
        if path.is_empty() {
            return Ok(None);
        }
        Ok(Some(
            fs::canonicalize(path).unwrap_or_else(|_| PathBuf::from(path)),
        ))
    }

    pub(super) fn lock_config(&self) -> Result<fs::File> {
        persistence::lock(&self.paths.config_file)
    }
}
