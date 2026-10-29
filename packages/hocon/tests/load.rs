use std::fs;

use luna_next_hocon::{Config, Error, load};
use serde_json::json;

#[test]
fn loads_objects_with_includes_precedence_and_substitutions_without_writing() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("packages.conf");
    let source = "include file(\"defaults.conf\")\nname = local\ncopy = ${name}\n";
    let defaults = "name = default\nenabled = true\n";
    fs::write(&path, source).unwrap();
    fs::write(directory.path().join("defaults.conf"), defaults).unwrap();

    assert_eq!(
        load(&path).unwrap(),
        json!({"name": "local", "copy": "local", "enabled": true})
    );
    assert_eq!(fs::read_to_string(&path).unwrap(), source);
    assert_eq!(
        fs::read_to_string(directory.path().join("defaults.conf")).unwrap(),
        defaults
    );
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 2);
}

#[test]
fn loads_root_arrays_with_comments_and_json_value_types() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("packages.conf");
    let source = r#"# Packages
// Preserve these comments.
[
    {name: "yay", source: git, command: [["build", "--install"]]},
    "text with ] and #",
    1, 2.5, true, false, null, [], {}
] # End
"#;
    fs::write(&path, source).unwrap();

    assert_eq!(
        load(&path).unwrap(),
        json!([
            {"name": "yay", "source": "git", "command": [["build", "--install"]]},
            "text with ] and #",
            1, 2.5, true, false, null, [], {}
        ])
    );
    assert_eq!(fs::read_to_string(&path).unwrap(), source);
    assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
}

#[test]
fn root_array_nested_includes_resolve_from_each_original_file() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("packages.conf");
    let nested = directory.path().join("nested");
    fs::create_dir(&nested).unwrap();
    fs::write(
        &path,
        "[ { include required(file(\"nested/package.conf\"))\nname = local } ]",
    )
    .unwrap();
    fs::write(
        nested.join("package.conf"),
        "include file(\"base.conf\")\nname = inherited\n",
    )
    .unwrap();
    fs::write(nested.join("base.conf"), "source = git\nversion = null\n").unwrap();

    assert_eq!(
        load(&path).unwrap(),
        json!([{"name": "local", "source": "git", "version": null}])
    );
}

#[test]
fn missing_files_return_errors_without_creating_parent_directories() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("missing/packages.conf");

    assert!(matches!(load(&path), Err(Error::Parse { path: actual, .. }) if actual == path));
    assert!(!path.parent().unwrap().exists());
}

#[test]
fn rejects_incomplete_arrays_and_content_after_the_root_array() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("packages.conf");
    for source in [
        "[",
        "[1, 2",
        "[{ name = } ]",
        "[{ name = yay ]",
        "[\"unterminated]",
        "[\"\"\"unterminated]",
        "[] trailing",
        "[]\nother = 1",
        "[] []",
        "[] }",
        "[ # commented closing bracket ]",
    ] {
        fs::write(&path, source).unwrap();
        assert!(load(&path).is_err(), "accepted {source:?}");
        assert_eq!(fs::read_to_string(&path).unwrap(), source);
    }
}

#[test]
fn read_only_objects_use_the_checked_parser() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("packages.conf");
    for source in ["name =", "{ name = yay", "include file("] {
        fs::write(&path, source).unwrap();
        assert!(load(&path).is_err(), "accepted {source:?}");
    }
}

#[test]
fn array_includes_report_missing_required_sources_and_cycles() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("packages.conf");
    for source in [
        "[{ include required(file(\"missing.conf\")) }]",
        "[{ include file(\"packages.conf\") }]",
    ] {
        fs::write(&path, source).unwrap();
        assert!(load(&path).is_err(), "accepted {source:?}");
    }
}

#[test]
fn editable_config_still_requires_an_object_root() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("packages.conf");
    fs::write(&path, "[]").unwrap();

    assert!(Config::open(&path).is_err());
    assert_eq!(load(&path).unwrap(), json!([]));
    assert_eq!(fs::read_to_string(&path).unwrap(), "[]");
}
