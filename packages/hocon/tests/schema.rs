#![cfg(feature = "schema")]

use std::{fs, path::PathBuf};

use luna_next_hocon::{Config, Error};
use serde_json::{Value, json};
use tempfile::TempDir;

struct File {
    _directory: TempDir,
    path: PathBuf,
    source: String,
    config: Config,
}

impl File {
    fn new(source: &str) -> Self {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.conf");
        fs::write(&path, source).unwrap();
        let config = Config::open(&path).unwrap();
        Self {
            _directory: directory,
            path,
            source: source.into(),
            config,
        }
    }

    fn validate(&self, schema: &Value) -> luna_next_hocon::Result<()> {
        let before = self.config.resolved().unwrap().clone();
        let result = self.config.validate(schema);
        assert_eq!(self.config.resolved().unwrap(), &before);
        assert_eq!(fs::read_to_string(&self.path).unwrap(), self.source);
        result
    }
}

fn validation_error(error: Error, pointer: &str) {
    let display = error.to_string();
    let Error::Validation { path, message } = error else {
        panic!("expected a configuration validation failure: {display}");
    };
    assert_eq!(path, pointer);
    assert!(!message.is_empty());
    assert!(display.contains(&format!("'{pointer}'")));
    assert!(display.contains(&message));
}

#[test]
fn validates_resolved_includes_substitutions_and_local_precedence() {
    let directory = tempfile::tempdir().unwrap();
    let defaults = directory.path().join("defaults.conf");
    let entry = directory.path().join("config.conf");
    let defaults_source = "wallpaper { fit = fill, duration = 300 }\n";
    let entry_source = concat!(
        "# Keep this comment and include.\n",
        "include file(\"defaults.conf\")\n",
        "wallpaper.duration = 400\n",
        "duration_copy = ${wallpaper.duration}\n"
    );
    fs::write(&defaults, defaults_source).unwrap();
    fs::write(&entry, entry_source).unwrap();
    let config = Config::open(&entry).unwrap();
    let snapshot = config.resolved().unwrap().clone();
    let schema = json!({
        "type": "object",
        "required": ["wallpaper", "duration_copy"],
        "properties": {
            "wallpaper": {
                "type": "object",
                "required": ["fit", "duration"],
                "properties": {
                    "fit": {"const": "fill"},
                    "duration": {"const": 400}
                }
            },
            "duration_copy": {"const": 400}
        }
    });

    config.validate(&schema).unwrap();
    assert_eq!(config.resolved().unwrap(), &snapshot);
    assert_eq!(fs::read_to_string(&entry).unwrap(), entry_source);
    assert_eq!(fs::read_to_string(&defaults).unwrap(), defaults_source);

    // Validation uses the already loaded snapshot, without rereading includes.
    fs::write(&defaults, "wallpaper.fit = changed\n").unwrap();
    config.validate(&schema).unwrap();
    assert_eq!(config.resolved().unwrap(), &snapshot);
    assert_eq!(fs::read_to_string(&entry).unwrap(), entry_source);
    assert_eq!(
        fs::read_to_string(&defaults).unwrap(),
        "wallpaper.fit = changed\n"
    );
}

#[test]
fn missing_properties_and_schema_defaults_do_not_change_configuration() {
    let file = File::new("");
    file.validate(&json!({
        "type": "object",
        "properties": {"duration": {"type": "integer", "default": 200}}
    }))
    .unwrap();
    assert_eq!(file.config.resolved().unwrap(), &json!({}));
    assert_eq!(file.config.get("duration").unwrap(), &Value::Null);

    validation_error(
        file.validate(&json!({"required": ["duration"]}))
            .unwrap_err(),
        "",
    );
}

#[test]
fn unknown_properties_are_allowed_unless_schema_disallows_them() {
    let file = File::new("extra = true\n");
    file.validate(&json!({"type": "object", "properties": {}}))
        .unwrap();
    validation_error(
        file.validate(&json!({"type": "object", "additionalProperties": false}))
            .unwrap_err(),
        "",
    );
}

#[test]
fn explicit_null_is_valid_only_when_schema_allows_it() {
    let file = File::new("duration = null\n");
    file.validate(&json!({
        "properties": {"duration": {"type": ["integer", "null"]}}
    }))
    .unwrap();
    validation_error(
        file.validate(&json!({"properties": {"duration": {"type": "integer"}}}))
            .unwrap_err(),
        "/duration",
    );
}

#[test]
fn type_enum_and_range_failures_report_configuration_pointers() {
    let schema = json!({
        "properties": {
            "wallpaper": {
                "type": "object",
                "properties": {
                    "fit": {"enum": ["fill", "fit"]},
                    "duration": {"type": "integer", "minimum": 0, "maximum": 1000}
                }
            }
        }
    });
    for (source, pointer) in [
        ("wallpaper.duration = nope\n", "/wallpaper/duration"),
        ("wallpaper.duration = 0.5\n", "/wallpaper/duration"),
        ("wallpaper.duration = -1\n", "/wallpaper/duration"),
        ("wallpaper.duration = 1001\n", "/wallpaper/duration"),
        ("wallpaper.fit = banana\n", "/wallpaper/fit"),
        ("wallpaper = false\n", "/wallpaper"),
    ] {
        validation_error(File::new(source).validate(&schema).unwrap_err(), pointer);
    }
    for duration in [0, 1000] {
        File::new(&format!("wallpaper.duration = {duration}\n"))
            .validate(&schema)
            .unwrap();
    }
}

#[test]
fn local_schema_references_validate_nested_arrays_and_escape_pointers() {
    let schema = json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$defs": {"flag": {"type": "boolean"}},
        "properties": {"a/b~c": {"type": "array", "items": {"$ref": "#/$defs/flag"}}}
    });
    File::new(r#"{"a/b~c": [true, false]}"#)
        .validate(&schema)
        .unwrap();
    validation_error(
        File::new(r#"{"a/b~c": [true, 3]}"#)
            .validate(&schema)
            .unwrap_err(),
        "/a~1b~0c/1",
    );
}

#[test]
fn boolean_schemas_are_supported() {
    let file = File::new("anything = [1, null, true]\n");
    file.validate(&json!(true)).unwrap();
    validation_error(file.validate(&json!(false)).unwrap_err(), "");
}

#[test]
fn malformed_and_unresolved_schemas_return_errors() {
    let file = File::new("size = 10\n");
    for schema in [
        json!(42),
        json!({"type": 42}),
        json!({"properties": {"size": {"type": "unknown-type"}}}),
        json!({"$ref": "#/$defs/missing"}),
        json!({"$schema": "https://example.invalid/custom-meta-schema.json"}),
    ] {
        let error = file.validate(&schema).unwrap_err();
        assert!(matches!(&error, Error::InvalidSchema { message, .. } if !message.is_empty()));
        assert!(error.to_string().contains("invalid JSON schema"));
    }
}

#[test]
fn external_file_and_http_references_are_not_retrieved() {
    let file = File::new("size = 10\n");
    let schema_file = file.path.with_file_name("external.json");
    fs::write(&schema_file, "false").unwrap();
    let file_url = url::Url::from_file_path(&schema_file).unwrap();

    // A local listener proves validation does not attempt an HTTP request.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let http_url = format!("http://{}/schema.json", listener.local_addr().unwrap());
    for reference in [file_url.as_str(), http_url.as_str()] {
        let error = file.validate(&json!({"$ref": reference})).unwrap_err();
        assert!(matches!(error, Error::InvalidSchema { .. }));
    }
    assert_eq!(
        listener.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
    assert_eq!(fs::read_to_string(schema_file).unwrap(), "false");
}
