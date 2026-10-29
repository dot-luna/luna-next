use luna_next_hocon::{Error, Result};
use luna_next_hocon_qml::{load_as_json, load_as_json_with_schema};
use serde_json::{Value, json};
use std::fs;

#[test]
fn returns_resolved_json_without_changing_source_files() {
    let directory = tempfile::tempdir().unwrap();
    let defaults = directory.path().join("defaults.conf");
    let entry = directory.path().join("config.conf");
    let defaults_source = "wallpaper { path = \"default.jpg\", duration = 300 }\n";
    let entry_source = "include file(\"defaults.conf\")\nwallpaper.duration = 500\n";
    fs::write(&defaults, defaults_source).unwrap();
    fs::write(&entry, entry_source).unwrap();

    let output = load_as_json(entry.to_str().unwrap()).unwrap();
    let value: Value = serde_json::from_str(&output).unwrap();
    assert_eq!(output, serde_json::to_string(&value).unwrap());
    assert_eq!(
        value,
        json!({"wallpaper": {"path": "default.jpg", "duration": 500}})
    );
    assert_eq!(fs::read_to_string(defaults).unwrap(), defaults_source);
    assert_eq!(fs::read_to_string(entry).unwrap(), entry_source);
}

#[test]
fn creates_missing_file_and_parent_directories() {
    let directory = tempfile::tempdir().unwrap();
    let entry = directory.path().join("nested/config.conf");

    let output = load_as_json(entry.to_str().unwrap()).unwrap();

    assert_eq!(serde_json::from_str::<Value>(&output).unwrap(), json!({}));
    assert_eq!(fs::read_to_string(entry).unwrap(), "");
}

#[test]
fn returns_parse_errors() {
    let directory = tempfile::tempdir().unwrap();
    let entry = directory.path().join("config.conf");
    fs::write(&entry, "wallpaper { duration = [").unwrap();

    let error = load_as_json(entry.to_str().unwrap()).unwrap_err();

    assert!(error.to_string().contains("cannot parse or resolve"));
    assert_eq!(
        fs::read_to_string(entry).unwrap(),
        "wallpaper { duration = ["
    );
}

#[test]
fn validates_resolved_values_without_applying_defaults_or_editing_sources() {
    let directory = tempfile::tempdir().unwrap();
    let defaults = directory.path().join("defaults.conf");
    let entry = directory.path().join("config.conf");
    let schema = directory.path().join("config.schema.json");
    let defaults_source = "wallpaper { path = \"default.jpg\", duration = 300 }\n";
    let entry_source = "include file(\"defaults.conf\")\nwallpaper.duration = 500\nselected = ${wallpaper.path}\nunknown = true\n";
    let schema_source = serde_json::to_string(&json!({
        "type": "object",
        "properties": {
            "wallpaper": {"$ref": "#/$defs/wallpaper"},
            "selected": {"const": "default.jpg"},
            "absent": {"type": "boolean", "default": true}
        },
        "required": ["wallpaper", "selected"],
        "$defs": {
            "wallpaper": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "duration": {"type": "integer", "minimum": 400}
                },
                "required": ["path", "duration"]
            }
        }
    }))
    .unwrap();
    fs::write(&defaults, defaults_source).unwrap();
    fs::write(&entry, entry_source).unwrap();
    fs::write(&schema, &schema_source).unwrap();

    let output =
        load_as_json_with_schema(entry.to_str().unwrap(), schema.to_str().unwrap()).unwrap();
    let value: Value = serde_json::from_str(&output).unwrap();

    assert_eq!(
        value,
        json!({
            "wallpaper": {"path": "default.jpg", "duration": 500},
            "selected": "default.jpg",
            "unknown": true
        })
    );
    assert_eq!(output, serde_json::to_string(&value).unwrap());
    assert_eq!(fs::read_to_string(defaults).unwrap(), defaults_source);
    assert_eq!(fs::read_to_string(entry).unwrap(), entry_source);
    assert_eq!(fs::read_to_string(schema).unwrap(), schema_source);
}

#[test]
fn empty_schema_path_preserves_loading_without_validation() {
    let directory = tempfile::tempdir().unwrap();
    let entry = directory.path().join("nested/config.conf");

    let output = load_as_json_with_schema(entry.to_str().unwrap(), "").unwrap();

    assert_eq!(output, "{}");
    assert_eq!(fs::read_to_string(entry).unwrap(), "");
}

#[test]
fn reports_validation_failure_with_a_field_pointer_and_leaves_sources_unchanged() {
    let directory = tempfile::tempdir().unwrap();
    let entry = directory.path().join("config.conf");
    let schema = directory.path().join("config.schema.json");
    let entry_source = "wallpaper.duration = \"slow\"\n";
    let schema_source =
        r#"{"properties":{"wallpaper":{"properties":{"duration":{"type":"integer"}}}}}"#;
    fs::write(&entry, entry_source).unwrap();
    fs::write(&schema, schema_source).unwrap();

    let error =
        load_as_json_with_schema(entry.to_str().unwrap(), schema.to_str().unwrap()).unwrap_err();

    assert!(matches!(
        &error,
        Error::Validation { path, .. } if path == "/wallpaper/duration"
    ));
    assert!(error.to_string().contains("/wallpaper/duration"));
    assert_eq!(fs::read_to_string(entry).unwrap(), entry_source);
    assert_eq!(fs::read_to_string(schema).unwrap(), schema_source);
}

#[test]
fn rejects_invalid_and_malformed_schema_files() {
    let directory = tempfile::tempdir().unwrap();
    let entry = directory.path().join("config.conf");
    let schema = directory.path().join("config.schema.json");
    fs::write(&entry, "enabled = true\n").unwrap();

    for schema_source in [r#"{"type":"not-a-type"}"#, "{\"type\":"] {
        fs::write(&schema, schema_source).unwrap();

        let result = load_as_json_with_schema(entry.to_str().unwrap(), schema.to_str().unwrap());

        assert!(result.is_err(), "accepted invalid schema {schema_source}");
        assert_eq!(fs::read_to_string(&schema).unwrap(), schema_source);
    }
    assert_eq!(fs::read_to_string(entry).unwrap(), "enabled = true\n");
}

#[test]
fn missing_schema_files_are_not_created() {
    let directory = tempfile::tempdir().unwrap();
    let entry = directory.path().join("config.conf");
    let schema = directory.path().join("missing/config.schema.json");
    fs::write(&entry, "enabled = true\n").unwrap();

    let result = load_as_json_with_schema(entry.to_str().unwrap(), schema.to_str().unwrap());

    assert!(result.is_err());
    assert!(!schema.exists());
    assert!(!schema.parent().unwrap().exists());
    assert_eq!(fs::read_to_string(entry).unwrap(), "enabled = true\n");
}

#[test]
fn external_schema_references_are_rejected() {
    let directory = tempfile::tempdir().unwrap();
    let entry = directory.path().join("config.conf");
    let schema = directory.path().join("config.schema.json");
    let external = directory.path().join("external.json");
    fs::write(&entry, "enabled = true\n").unwrap();
    fs::write(&external, r#"{"type":"object"}"#).unwrap();

    for reference in [
        "https://example.invalid/config.schema.json".to_owned(),
        format!("file://{}", external.display()),
    ] {
        fs::write(&schema, json!({"$ref": reference}).to_string()).unwrap();

        let result: Result<String> =
            load_as_json_with_schema(entry.to_str().unwrap(), schema.to_str().unwrap());

        assert!(matches!(result, Err(Error::InvalidSchema { .. })));
    }
}
