use crate::{Error, Result};
use serde_json::{Map, Value, json};

// Embed the renderer-owned schema so API clients validate the same settings without an install.
const SCHEMA: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../src/luna-wallpaper/src/config.schema.json"
));

pub(super) fn schema() -> Result<Value> {
    Ok(serde_json::from_str(SCHEMA)?)
}
/// Fill application defaults for reads and validation without writing them into HOCON.
pub(super) fn effective(value: &Value) -> Value {
    let mut defaults = json!({
        "wallpaper": {
            "source": "",
            "fit": "fill",
            "background_color": "#000000"
        },
        "playback": {"pause_when_output_inactive": true},
        "transition": {"type": "fade", "duration_ms": 200}
    });
    merge(&mut defaults, value);
    defaults
}
pub(super) fn merge(target: &mut Value, changes: &Value) {
    if let Value::Object(changes) = changes {
        if !target.is_object() {
            *target = json!({});
        }
        let target = target.as_object_mut().unwrap();
        for (key, value) in changes {
            merge(target.entry(key).or_insert(Value::Null), value);
        }
    } else {
        *target = changes.clone();
    }
}
/// Convert patch leaves into local HOCON edits; empty objects add no writes.
/// Object keys cannot contain dots because the editor uses dotted paths.
pub(super) fn flatten(value: &Value, prefix: &str, output: &mut Map<String, Value>) -> Result<()> {
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
