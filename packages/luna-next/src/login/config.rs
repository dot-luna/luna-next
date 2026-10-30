use super::Login;
use crate::{Error, Result, config_io};
use luna_next_hocon::Config;
use serde_json::{Map, Value, json};

impl Login {
    /// Read application defaults and saved overrides without resolving desktop theme values.
    /// Missing files are created; missing dot-separated keys return JSON null.
    pub fn get_config(&self, key: Option<&str>) -> Result<Value> {
        let config = Config::open(&self.paths.config_file)?;
        let value = effective(config.resolved()?);
        luna_next_hocon::validate_value(&value, &schema()?)?;
        lookup(value, key)
    }

    /// Merge and validate nested JSON settings, then save only local HOCON edits atomically.
    /// Includes and comments remain intact. This does not rebuild or activate SDDM.
    pub fn update_config(&self, changes: Value) -> Result<Value> {
        if !changes.is_object() {
            return Err(Error::Message(
                "configuration changes must be a JSON object".into(),
            ));
        }
        let _lock = config_io::lock(&self.paths.config_file)?;
        self.update_locked(&changes)
    }

    pub(super) fn update_locked(&self, changes: &Value) -> Result<Value> {
        let mut config = Config::open(&self.paths.config_file)?;
        let mut candidate = config.resolved()?.clone();
        merge(&mut candidate, changes);
        let schema = schema()?;
        luna_next_hocon::validate_value(&effective(&candidate), &schema)?;
        let mut leaves = Map::new();
        flatten(changes, "", &mut leaves)?;
        if !leaves.is_empty() {
            config.set_many_validated(&leaves, &schema)?;
        }
        Ok(effective(config.resolved()?))
    }

    /// Read the saved screen name, defaulting to the built-in `default` screen.
    pub fn current(&self) -> Result<String> {
        Ok(self
            .get_config(Some("screen.name"))?
            .as_str()
            .expect("validated name")
            .to_owned())
    }

    /// Validate an available screen and save its selection, without changing SDDM.
    pub fn set(&self, name: &str) -> Result<Value> {
        let _lock = config_io::lock(&self.paths.config_file)?;
        self.screen_path(name)?;
        self.update_locked(&json!({"screen": {"name": name}}))
    }
}

pub(super) fn schema() -> Result<Value> {
    let mut schema: Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../src/luna-login/src/config.schema.json"
    )))?;
    let theme: Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../themes/theme.schema.json"
    )))?;
    // Login owns its settings while shared palette/font contracts keep one schema owner.
    for key in ["colors", "fonts"] {
        schema["properties"][key] = theme["properties"][key].clone();
    }
    Ok(schema)
}

pub(super) fn validate_name(name: &str) -> Result<()> {
    luna_next_hocon::validate_value(&json!({"screen": {"name": name}}), &schema()?)?;
    Ok(())
}

fn effective(value: &Value) -> Value {
    let mut defaults = json!({
        "screen": {"name": "default"},
        "wallpaper": {"source": "", "type": "auto", "fit": "fill", "background_color": "#000000"},
        "colors": {}, "fonts": {}
    });
    merge(&mut defaults, value);
    defaults
}

pub(super) fn merge(target: &mut Value, source: &Value) {
    if let Value::Object(fields) = source {
        if !target.is_object() {
            *target = json!({});
        }
        for (key, value) in fields {
            merge(&mut target[key], value);
        }
    } else {
        *target = source.clone();
    }
}

fn flatten(value: &Value, prefix: &str, output: &mut Map<String, Value>) -> Result<()> {
    if let Value::Object(fields) = value {
        for (key, value) in fields {
            if key.is_empty() || key.contains('.') {
                return Err(Error::Message(
                    "updated configuration keys must be nonempty and contain no dots".into(),
                ));
            }
            let path = if prefix.is_empty() {
                key.clone()
            } else {
                format!("{prefix}.{key}")
            };
            flatten(value, &path, output)?;
        }
    } else {
        output.insert(prefix.into(), value.clone());
    }
    Ok(())
}

fn lookup(value: Value, key: Option<&str>) -> Result<Value> {
    match key {
        None => Ok(value),
        Some(key) if key.split('.').any(str::is_empty) => Err(Error::Message(
            "configuration keys use nonempty dot-separated segments".into(),
        )),
        Some(key) => Ok(key
            .split('.')
            .try_fold(&value, |value, key| value.as_object()?.get(key))
            .cloned()
            .unwrap_or(Value::Null)),
    }
}
