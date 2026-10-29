use std::path::Path;

use serde_json::{Value, json};

use super::defaults;
use crate::{Error, Result};

pub(super) fn source_schema() -> Result<Value> {
    Ok(serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../themes/theme.schema.json"
    )))?)
}

pub(super) fn selection_schema() -> Result<Value> {
    Ok(serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../themes/selection.schema.json"
    )))?)
}

pub(super) fn read(directory: &Path) -> Result<Value> {
    let value = luna_next_hocon::load(directory.join("theme.conf"))?;
    luna_next_hocon::validate_value(&value, &source_schema()?)?;
    Ok(value)
}

pub(super) fn resolve(source: &Value, name: &str) -> Result<Value> {
    let schema = source_schema()?;
    luna_next_hocon::validate_value(source, &schema)?;
    let mut value = defaults::dark();
    if source["colors"]["mode"] == "light" {
        merge(&mut value["colors"], &defaults::light_colors());
    }
    merge(&mut value, source);
    // A changed fill needs its own readable foreground; explicit author choices win.
    for role in [
        "accent",
        "selection",
        "secondary_accent",
        "error",
        "warning",
        "notice",
        "success",
        "info",
    ] {
        let foreground = format!("{role}_foreground");
        if let Some(fill) = source["colors"][role].as_str()
            && source["colors"].get(&foreground).is_none()
        {
            value["colors"][&foreground] = json!(readable_foreground(fill));
        }
    }
    for role in [
        "secondary_accent",
        "error",
        "warning",
        "success",
        "info",
        "link",
    ] {
        let emphasis = format!("{role}_emphasis");
        if let Some(fill) = source["colors"].get(role)
            && source["colors"].get(&emphasis).is_none()
        {
            value["colors"][&emphasis] = fill.clone();
        }
    }
    luna_next_hocon::validate_value(&value, &schema)?;
    value["name"] = json!(name);
    Ok(value)
}

fn merge(target: &mut Value, source: &Value) {
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

fn readable_foreground(fill: &str) -> &'static str {
    let luminance: f64 = [0.2126, 0.7152, 0.0722]
        .iter()
        .enumerate()
        .map(|(index, weight)| {
            let offset = 1 + index * 2;
            let channel = u8::from_str_radix(&fill[offset..offset + 2], 16)
                .expect("validated color") as f64
                / 255.0;
            weight
                * if channel <= 0.04045 {
                    channel / 12.92
                } else {
                    ((channel + 0.055) / 1.055).powf(2.4)
                }
        })
        .sum();
    if (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) {
        "#000000"
    } else {
        "#ffffff"
    }
}

pub(super) fn name(name: &str) -> Result<()> {
    luna_next_hocon::validate_value(&json!({"theme": {"name": name}}), &selection_schema()?)?;
    Ok(())
}

pub(super) fn lookup(value: Value, key: Option<&str>) -> Result<Value> {
    match key {
        None => Ok(value),
        Some(key) if key.split('.').any(str::is_empty) => Err(Error::Message(
            "theme keys use nonempty dot-separated segments".into(),
        )),
        Some(key) => Ok(key
            .split('.')
            .try_fold(&value, |value, key| value.as_object()?.get(key))
            .cloned()
            .unwrap_or(Value::Null)),
    }
}
