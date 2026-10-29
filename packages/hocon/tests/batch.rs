use std::{fs, path::PathBuf};

use luna_next_hocon::{Config, Error};
use serde_json::{Map, Value, json};
use tempfile::TempDir;

struct File {
    directory: TempDir,
    path: PathBuf,
    config: Config,
}

impl File {
    fn new(source: &str) -> Self {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.conf");
        fs::write(&path, source).unwrap();
        let config = Config::open(&path).unwrap();
        Self {
            directory,
            path,
            config,
        }
    }

    fn assert_unchanged(&self, source: &str, resolved: &Value) {
        assert_eq!(fs::read_to_string(&self.path).unwrap(), source);
        assert_eq!(self.config.source(), source);
        assert_eq!(self.config.resolved().unwrap(), resolved);
        assert_eq!(fs::read_dir(self.directory.path()).unwrap().count(), 1);
    }
}

fn changes(value: Value) -> Map<String, Value> {
    value.as_object().unwrap().clone()
}

#[test]
fn batch_preserves_source_and_included_defaults_and_refreshes_the_snapshot() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("config.conf");
    let defaults = directory.path().join("defaults.conf");
    let defaults_source = concat!(
        "wallpaper { path = \"/defaults/image.jpg\", fit = fill, duration = 300 }\n",
        "unmodified_default = true\n"
    );
    let source = concat!(
        "# My wallpaper settings\n",
        "include file(\"defaults.conf\")\n",
        "wallpaper.duration = 500 # Keep this comment\n",
        "unrelated { label = \"keep exactly\", enabled = true }\n"
    );
    fs::write(&defaults, defaults_source).unwrap();
    fs::write(&path, source).unwrap();
    let mut config = Config::open(&path).unwrap();
    assert_eq!(config.source(), source);

    config
        .set_many(&changes(json!({
            "wallpaper.duration": 700,
            "wallpaper.fit": "fit",
            "wallpaper.output": null
        })))
        .unwrap();

    assert_eq!(config.get("wallpaper.duration").unwrap(), &json!(700));
    assert_eq!(config.get("wallpaper.fit").unwrap(), &json!("fit"));
    assert_eq!(config.get("wallpaper.output").unwrap(), &Value::Null);
    assert_eq!(
        config.get("wallpaper").unwrap().get("output"),
        Some(&Value::Null)
    );
    let saved = fs::read_to_string(&path).unwrap();
    assert_eq!(config.source(), saved);
    for untouched in [
        "# My wallpaper settings",
        "include file(\"defaults.conf\")",
        "# Keep this comment",
        "unrelated { label = \"keep exactly\", enabled = true }",
    ] {
        assert!(saved.contains(untouched), "lost source: {untouched}");
    }
    assert!(!saved.contains("/defaults/image.jpg"));
    assert!(!saved.contains("unmodified_default"));
    assert_eq!(fs::read_to_string(defaults).unwrap(), defaults_source);
    assert_eq!(
        Config::open(path).unwrap().resolved().unwrap(),
        config.resolved().unwrap()
    );
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 2);
}

#[test]
fn a_later_unsafe_source_edit_rolls_back_the_entire_batch() {
    let source = "a = 1\ntemplate { duration = 300 }\nz = ${template}\n";
    let mut file = File::new(source);
    let before = file.config.resolved().unwrap().clone();

    let error = file
        .config
        .set_many(&changes(json!({"a": 2, "z.duration": 700})))
        .unwrap_err();

    assert!(matches!(error, Error::Edit { .. }));
    file.assert_unchanged(source, &before);
}

#[test]
fn invalid_paths_reject_the_whole_batch() {
    let source = "a = 1\nz = 2\n";
    let mut file = File::new(source);
    let before = file.config.resolved().unwrap().clone();

    for path in ["", ".z", "z.", "z..value"] {
        let mut values = changes(json!({"a": 10}));
        values.insert(path.into(), json!(20));
        let error = file.config.set_many(&values).unwrap_err();
        assert!(matches!(error, Error::InvalidPath { .. }), "{path}");
        file.assert_unchanged(source, &before);
    }
}

#[test]
fn inconsistent_parent_and_child_requests_never_save_partial_values() {
    let source = "unrelated = true\nwallpaper { duration = 300, fit = fill }\n";
    let mut file = File::new(source);
    let before = file.config.resolved().unwrap().clone();

    for parent in [json!({"duration": 400}), json!(false)] {
        let error = file
            .config
            .set_many(&changes(json!({
                "unrelated": false,
                "wallpaper": parent,
                "wallpaper.duration": 500
            })))
            .unwrap_err();
        assert!(matches!(error, Error::Edit { .. }));
        file.assert_unchanged(source, &before);
    }
}

#[test]
fn external_source_edits_are_preserved_and_leave_the_loaded_snapshot_unchanged() {
    let source = "a = 1\nb = 2\n";
    let mut file = File::new(source);
    let before = file.config.resolved().unwrap().clone();
    let external = "# Edited elsewhere\na = 3\nb = 2\n";
    fs::write(&file.path, external).unwrap();

    assert!(matches!(
        file.config.set_many(&changes(json!({"a": 10, "b": 20}))),
        Err(Error::Conflict { .. })
    ));
    assert_eq!(fs::read_to_string(&file.path).unwrap(), external);
    assert_eq!(file.config.source(), source);
    assert_eq!(file.config.resolved().unwrap(), &before);
    assert_eq!(fs::read_dir(file.directory.path()).unwrap().count(), 1);
}

#[test]
fn empty_batch_leaves_source_and_snapshot_untouched() {
    let source = "# Nothing to change\na = 1\n";
    let mut file = File::new(source);
    let before = file.config.resolved().unwrap().clone();
    file.config.set_many(&Map::new()).unwrap();
    file.assert_unchanged(source, &before);
}

#[test]
fn new_nested_settings_use_blocks_and_preserve_late_include_precedence() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("config.conf");
    let base = directory.path().join("base.conf");
    fs::write(&base, "background { x = 4, inherited = true }\n").unwrap();
    let source = "# Keep this include\ninclude required(file(\"base.conf\"))\n";
    fs::write(&path, source).unwrap();
    let mut config = Config::open(&path).unwrap();
    config
        .set_many(&changes(
            json!({"background.x": 12, "background.nested": {"null": null, "values": [1, 2]}}),
        ))
        .unwrap();
    let saved = fs::read_to_string(&path).unwrap();
    assert!(saved.starts_with(source));
    assert!(saved.contains("\"background\" {\n"));
    assert!(saved.contains("  \"nested\" {\n"));
    assert!(!saved.contains("\"background\".\""));
    assert_eq!(
        config.get("background").unwrap(),
        &json!({"x": 12, "inherited": true, "nested": {"null": null, "values": [1, 2]}})
    );
    config.unset("background.x").unwrap();
    assert_eq!(config.get("background.x").unwrap(), &json!(4));
    assert_eq!(
        fs::read_to_string(base).unwrap(),
        "background { x = 4, inherited = true }\n"
    );
}

#[cfg(feature = "schema")]
#[test]
fn validated_batch_checks_final_includes_and_substitutions_before_saving() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("config.conf");
    let defaults = directory.path().join("defaults.conf");
    let defaults_source = "wallpaper { fit = fill, duration = 300 }\n";
    let source = concat!(
        "# Preserve the include and substitution\n",
        "include file(\"defaults.conf\")\n",
        "duration_copy = ${wallpaper.duration}\n"
    );
    fs::write(&defaults, defaults_source).unwrap();
    fs::write(&path, source).unwrap();
    let mut config = Config::open(&path).unwrap();
    let schema = json!({
        "required": ["wallpaper", "duration_copy"],
        "properties": {
            "wallpaper": {
                "required": ["fit", "duration"],
                "properties": {
                    "fit": {"const": "fit"},
                    "duration": {"const": 700},
                    "unused": {"default": "do not save"}
                }
            },
            "duration_copy": {"const": 700}
        }
    });

    // Both requested values and the existing substitution must be resolved
    // together; validating any intermediate setting would reject this change.
    config
        .set_many_validated(
            &changes(json!({"wallpaper.duration": 700, "wallpaper.fit": "fit"})),
            &schema,
        )
        .unwrap();

    assert_eq!(config.get("duration_copy").unwrap(), &json!(700));
    assert_eq!(config.get("wallpaper.fit").unwrap(), &json!("fit"));
    assert_eq!(config.get("wallpaper.unused").unwrap(), &Value::Null);
    let saved = fs::read_to_string(&path).unwrap();
    assert!(saved.starts_with(source));
    assert!(!saved.contains("unused"));
    assert!(!saved.contains("do not save"));
    assert_eq!(config.source(), saved);
    assert_eq!(fs::read_to_string(defaults).unwrap(), defaults_source);
    assert_eq!(
        Config::open(path).unwrap().resolved().unwrap(),
        config.resolved().unwrap()
    );
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 2);
}

#[cfg(feature = "schema")]
#[test]
fn invalid_final_schema_or_value_rejects_all_changes_and_retains_the_snapshot() {
    let source = "wallpaper { duration = 300, fit = fill }\n";
    let mut file = File::new(source);
    let before = file.config.resolved().unwrap().clone();
    let values = changes(json!({"wallpaper.duration": 700, "wallpaper.fit": "bogus"}));
    let schema = json!({
        "properties": {
            "wallpaper": {"properties": {"fit": {"enum": ["fill", "fit"]}}}
        }
    });

    let error = file
        .config
        .set_many_validated(&values, &schema)
        .unwrap_err();
    assert!(matches!(error, Error::Validation { ref path, .. } if path == "/wallpaper/fit"));
    file.assert_unchanged(source, &before);

    let error = file
        .config
        .set_many_validated(&values, &json!({"type": "unknown-type"}))
        .unwrap_err();
    assert!(matches!(error, Error::InvalidSchema { .. }));
    file.assert_unchanged(source, &before);
}

#[cfg(feature = "schema")]
#[test]
fn value_validation_does_not_add_defaults_and_rejects_external_references() {
    use luna_next_hocon::validate_value;

    let value = json!({"duration": 300});
    let before = value.clone();
    validate_value(
        &value,
        &json!({
            "properties": {
                "duration": {"type": "integer"},
                "fit": {"default": "fill"}
            }
        }),
    )
    .unwrap();
    assert_eq!(value, before);
    assert!(matches!(
        validate_value(&value, &json!({"properties": {"duration": {"maximum": 100}}})),
        Err(Error::Validation { path, .. }) if path == "/duration"
    ));

    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let reference = format!("http://{}/schema.json", listener.local_addr().unwrap());
    assert!(matches!(
        validate_value(&value, &json!({"$ref": reference})),
        Err(Error::InvalidSchema { .. })
    ));
    assert_eq!(
        listener.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
    assert_eq!(value, before);
}
