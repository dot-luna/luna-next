use luna_next_hocon_qml::load_as_json;
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
