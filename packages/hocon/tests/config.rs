use std::{fs, path::PathBuf};

use luna_next_hocon::{Config, Error};
use serde_json::{Value, json};
use tempfile::TempDir;

const DEFAULTS: &str = r#"wallpaper {
  path = "/usr/share/wallpapers/default.jpg"
  transition = "fade"
  duration = 300
}
"#;

const USER: &str = r#"# User preferences
include file("defaults.conf")

wallpaper {
  duration = 500 # Preferred duration
}

# Keep this block exactly as written.
unrelated { label = "leave me alone", enabled = true }
"#;

struct Files {
    dir: TempDir,
    entry: PathBuf,
    defaults: PathBuf,
}

impl Files {
    fn new(source: &str) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let entry = dir.path().join("config.conf");
        let defaults = dir.path().join("defaults.conf");
        fs::write(&entry, source).unwrap();
        fs::write(&defaults, DEFAULTS).unwrap();
        Self {
            dir,
            entry,
            defaults,
        }
    }

    fn open(&self) -> Config {
        Config::open(&self.entry).unwrap()
    }

    fn source(&self) -> String {
        fs::read_to_string(&self.entry).unwrap()
    }

    fn assert_defaults_unchanged(&self) {
        assert_eq!(fs::read_to_string(&self.defaults).unwrap(), DEFAULTS);
    }
}

#[test]
fn includes_resolve_relative_to_entry_and_user_values_win() {
    let files = Files::new(USER);
    let config = files.open();

    assert_eq!(config.get("wallpaper.duration").unwrap(), &json!(500));
    assert_eq!(config.get("wallpaper.transition").unwrap(), &json!("fade"));
    assert_eq!(
        config.get("wallpaper.path").unwrap(),
        &json!("/usr/share/wallpapers/default.jpg")
    );
    assert_eq!(
        config.get("wallpaper").unwrap(),
        &config.resolved().unwrap()["wallpaper"]
    );
    let serialized: Value = serde_json::from_str(&config.to_json().unwrap()).unwrap();
    assert_eq!(&serialized, config.resolved().unwrap());
    assert_eq!(files.source(), USER);
    files.assert_defaults_unchanged();
    assert_eq!(fs::read_dir(files.dir.path()).unwrap().count(), 2);
}

#[test]
fn nested_includes_resolve_relative_to_the_including_file() {
    let files = Files::new("include file(\"layers/theme.conf\")\ncolor = blue\n");
    let layers = files.dir.path().join("layers");
    fs::create_dir(&layers).unwrap();
    fs::write(
        layers.join("theme.conf"),
        "include file(\"base.conf\")\nsize = 24\n",
    )
    .unwrap();
    fs::write(
        layers.join("base.conf"),
        "color = red\nsize = 12\nenabled = true\n",
    )
    .unwrap();

    let config = files.open();
    assert_eq!(
        config.resolved().unwrap(),
        &json!({"color": "blue", "size": 24, "enabled": true})
    );
}

#[test]
fn extensionless_includes_merge_json_before_hocon() {
    for directive in ["include \"theme\"", "include file(\"theme\")"] {
        let files = Files::new(directive);
        fs::write(
            files.dir.path().join("theme.json"),
            r#"{"shared": {"winner": "json", "json_only": true}}"#,
        )
        .unwrap();
        fs::write(
            files.dir.path().join("theme.conf"),
            "shared { winner = hocon, hocon_only = true }\n",
        )
        .unwrap();

        assert_eq!(
            files.open().resolved().unwrap(),
            &json!({"shared": {"winner": "hocon", "json_only": true, "hocon_only": true}}),
            "{directive}"
        );
    }
}

#[test]
fn optional_includes_do_not_hide_directories_as_missing_files() {
    for name in ["theme", "theme.json", "theme.conf"] {
        let files = Files::new("include file(\"theme\")\n");
        fs::create_dir(files.dir.path().join(name)).unwrap();
        assert!(
            matches!(Config::open(&files.entry), Err(Error::Parse { .. })),
            "treated directory {name} as a missing include"
        );
    }
}

#[cfg(unix)]
#[test]
fn optional_includes_report_permission_errors_during_extension_lookup() {
    use std::os::unix::fs::{PermissionsExt, symlink};

    for directive in ["include file(\"secret/theme\")", "include file(\"theme\")"] {
        let files = Files::new(directive);
        let secret = files.dir.path().join("secret");
        fs::create_dir(&secret).unwrap();
        let included = secret.join("theme.json");
        fs::write(&included, "{}").unwrap();
        symlink(&included, files.dir.path().join("theme.json")).unwrap();
        let permissions = fs::metadata(&secret).unwrap().permissions();
        fs::set_permissions(&secret, fs::Permissions::from_mode(0o000)).unwrap();

        let denied = matches!(fs::metadata(&included), Err(error)
            if error.kind() == std::io::ErrorKind::PermissionDenied);
        let result = Config::open(&files.entry);
        fs::set_permissions(&secret, permissions).unwrap();

        // Privileged test runners can bypass directory permissions.
        if denied {
            assert!(matches!(result, Err(Error::Parse { .. })), "{directive}");
        }
    }
}

#[test]
fn multiline_closing_quote_runs_preserve_values_and_source_spans() {
    for quotes in 3..=8 {
        let multiline = format!("\"\"\"hello{}", "\"".repeat(quotes));
        let source = format!("value = {multiline}\nother = 1\n");
        let files = Files::new(&source);
        let mut config = files.open();
        let expected = json!(format!("hello{}", "\"".repeat(quotes - 3)));

        assert_eq!(config.get("value").unwrap(), &expected);
        config.set("other", json!(2)).unwrap();
        assert!(files.source().contains(&multiline));
        assert_eq!(files.open().get("value").unwrap(), &expected);
        config.set("value", json!("replacement")).unwrap();
        assert_eq!(files.open().get("value").unwrap(), &json!("replacement"));
        assert_eq!(config.get("other").unwrap(), &json!(2));

        fs::write(&files.entry, &source).unwrap();
        let mut config = files.open();
        config.unset("value").unwrap();
        assert_eq!(files.open().resolved().unwrap(), &json!({"other": 1}));
    }
}

#[test]
fn included_multiline_strings_support_nested_arrays_concatenation_and_literal_escapes() {
    let files = Files::new("include file(\"defaults.conf\")\nother = 1\n");
    let content = "雪\\u0061\\n\n# // { [ \"quoted\"";
    let multiline = format!("\"\"\"{content}\"\"\"");
    let defaults = format!(
        "{{\n nested {{ list = [{multiline}, {{ value = {multiline} }}] }}\n joined = prefix{multiline}suffix\n escaped = \"four quotes: \\\"\\\"\\\"\\\"\"\n}}\n"
    );
    fs::write(&files.defaults, &defaults).unwrap();
    let mut config = files.open();

    assert_eq!(
        config.get("nested.list").unwrap(),
        &json!([content, {"value": content}])
    );
    assert_eq!(
        config.get("joined").unwrap(),
        &json!(format!("prefix{content}suffix"))
    );
    assert_eq!(
        config.get("escaped").unwrap(),
        &json!("four quotes: \"\"\"\"")
    );
    config.set("nested.extra", json!(true)).unwrap();
    assert_eq!(
        config.get("nested.list").unwrap(),
        &json!([content, {"value": content}])
    );
    assert_eq!(fs::read_to_string(&files.defaults).unwrap(), defaults);
}

#[test]
fn set_edits_user_layer_and_preserves_unrelated_source() {
    let files = Files::new(USER);
    let mut config = files.open();
    config.set("wallpaper.duration", json!(600)).unwrap();
    config.set("wallpaper.transition", json!("slide")).unwrap();

    assert_eq!(config.get("wallpaper.duration").unwrap(), &json!(600));
    assert_eq!(config.get("wallpaper.transition").unwrap(), &json!("slide"));
    let source = files.source();
    assert!(source.contains("include file(\"defaults.conf\")"));
    assert!(source.contains("# User preferences"));
    assert!(source.contains("# Preferred duration"));
    assert!(source.contains("# Keep this block exactly as written.\nunrelated { label = \"leave me alone\", enabled = true }"));
    assert!(!source.contains("/usr/share/wallpapers/default.jpg"));
    assert_eq!(files.open().get("wallpaper.duration").unwrap(), &json!(600));
    files.assert_defaults_unchanged();

    config.unset("wallpaper.transition").unwrap();
    assert_eq!(config.get("wallpaper.transition").unwrap(), &json!("fade"));
    files.assert_defaults_unchanged();
}

#[test]
fn unset_reveals_included_values_and_missing_local_definition_is_a_noop() {
    let files = Files::new(USER);
    let mut config = files.open();
    config.unset("wallpaper.duration").unwrap();
    assert_eq!(config.get("wallpaper.duration").unwrap(), &json!(300));
    assert!(files.source().contains("include file(\"defaults.conf\")"));

    let source = files.source();
    config.unset("wallpaper.duration").unwrap();
    config.unset("wallpaper.path").unwrap();
    config.unset("does.not.exist").unwrap();
    assert_eq!(files.source(), source);
    assert_eq!(files.open().get("wallpaper.duration").unwrap(), &json!(300));
    files.assert_defaults_unchanged();
}

#[test]
fn unset_removes_all_duplicate_and_dotted_local_definitions() {
    let files = Files::new(
        "include file(\"defaults.conf\")\nwallpaper.duration = 410\nwallpaper { duration = 420, local = true }\nwallpaper.duration = 430\n",
    );
    let mut config = files.open();
    assert_eq!(config.get("wallpaper.duration").unwrap(), &json!(430));
    config.unset("wallpaper.duration").unwrap();
    assert_eq!(config.get("wallpaper.duration").unwrap(), &json!(300));
    assert_eq!(config.get("wallpaper.local").unwrap(), &json!(true));
    assert_eq!(files.open().get("wallpaper.duration").unwrap(), &json!(300));
    files.assert_defaults_unchanged();
}

#[test]
fn objects_merge_with_includes_and_unset_removes_local_descendants() {
    let files = Files::new(USER);
    let mut config = files.open();
    config
        .set("wallpaper", json!({"duration": 650, "custom": true}))
        .unwrap();
    assert_eq!(
        config.get("wallpaper").unwrap(),
        &json!({
            "path": "/usr/share/wallpapers/default.jpg",
            "transition": "fade",
            "duration": 650,
            "custom": true
        })
    );
    config.unset("wallpaper").unwrap();
    assert_eq!(config.get("wallpaper.duration").unwrap(), &json!(300));
    assert_eq!(config.get("wallpaper.custom").unwrap(), &Value::Null);
    files.assert_defaults_unchanged();
}

#[test]
fn typed_values_round_trip_through_disk() {
    let files = Files::new("include file(\"defaults.conf\")\n");
    let mut config = files.open();
    let cases = [
        (
            "string",
            json!("quotes: \" \\ and newline\n${literal} # not a comment"),
        ),
        ("integer", json!(-42)),
        ("unsigned", json!(u64::MAX)),
        ("float", json!(1.25)),
        ("boolean", json!(false)),
        ("array", json!([1, "two", true, null, {"nested": [3]}])),
        (
            "object",
            json!({"child": "value", "with.dot": 2, "empty": {}}),
        ),
        ("null", Value::Null),
    ];
    for (name, value) in &cases {
        config
            .set(&format!("values.{name}"), value.clone())
            .unwrap();
    }
    let reopened = files.open();
    for (name, value) in cases {
        assert_eq!(
            reopened.get(&format!("values.{name}")).unwrap(),
            &value,
            "{name}"
        );
    }
    assert_eq!(
        reopened.get("values.object.child").unwrap(),
        &json!("value")
    );
    files.assert_defaults_unchanged();
}

#[test]
fn explicit_null_and_missing_keys_read_as_null() {
    let files = Files::new(USER);
    let mut config = files.open();
    config.set("wallpaper.duration", Value::Null).unwrap();
    assert_eq!(config.get("wallpaper.duration").unwrap(), &Value::Null);
    assert_eq!(config.get("missing").unwrap(), &Value::Null);
    assert_eq!(
        config.resolved().unwrap()["wallpaper"].get("duration"),
        Some(&Value::Null)
    );
    assert!(config.resolved().unwrap().get("missing").is_none());
    config.unset("wallpaper.duration").unwrap();
    assert_eq!(config.get("wallpaper.duration").unwrap(), &json!(300));
}

#[test]
fn nested_settings_can_replace_literal_values_and_restore_them_on_unset() {
    for original in [
        "2",
        "null",
        "false",
        "\"hello\"",
        "[1, 2]",
        "[1] [2]",
        "one two",
    ] {
        let source = format!("a = {original} # keep this declaration\nunrelated = true\n");
        let files = Files::new(&source);
        let mut config = files.open();
        let previous = config.get("a").unwrap().clone();
        config.set("a.b", json!(1)).unwrap();
        assert_eq!(config.get("a.b").unwrap(), &json!(1));
        assert!(files.source().starts_with(&source));
        assert_eq!(files.open().get("a.b").unwrap(), &json!(1));
        config.unset("a.b").unwrap();
        assert_eq!(config.get("a").unwrap(), &previous);
        assert_eq!(config.get("a.b").unwrap(), &Value::Null);
        assert_eq!(config.get("unrelated").unwrap(), &json!(true));
        files.assert_defaults_unchanged();
    }
}

#[test]
fn missing_paths_and_reads_through_non_objects_return_null_without_changes() {
    let source = "title = Luna\ncount = 1\nenabled = true\nitems = [{ name = first }]\nempty = null\nnested { present = 7 }\n";
    let files = Files::new(source);
    let config = files.open();
    let resolved = config.resolved().unwrap().clone();

    for path in [
        "missing",
        "missing.child",
        "nested.absent",
        "nested.absent.leaf",
        "title.child",
        "count.child",
        "enabled.child",
        "items.0",
        "items.0.name",
        "empty.child",
    ] {
        assert_eq!(config.get(path).unwrap(), &Value::Null, "{path}");
    }

    assert_eq!(config.get("title").unwrap(), &json!("Luna"));
    assert_eq!(config.get("nested.present").unwrap(), &json!(7));
    assert_eq!(config.get("items").unwrap(), &json!([{ "name": "first" }]));
    assert_eq!(config.resolved().unwrap(), &resolved);
    assert_eq!(files.source(), source);
    files.assert_defaults_unchanged();
}

#[test]
fn edits_work_with_root_braces_and_inline_commas() {
    let files = Files::new(
        "{\n  include file(\"defaults.conf\")\n  wallpaper { duration = 500, keep = true }, unrelated = [1, 2]\n}\n",
    );
    let mut config = files.open();
    config.unset("wallpaper.duration").unwrap();
    assert_eq!(config.get("wallpaper.duration").unwrap(), &json!(300));
    assert_eq!(config.get("wallpaper.keep").unwrap(), &json!(true));
    config.set("wallpaper.duration", json!(700)).unwrap();
    config.set("new.nested", json!("value")).unwrap();
    assert_eq!(files.open().get("wallpaper.duration").unwrap(), &json!(700));
    assert_eq!(config.get("new.nested").unwrap(), &json!("value"));
    assert!(files.source().contains("unrelated = [1, 2]"));
    assert!(files.source().contains("include file(\"defaults.conf\")"));
    files.assert_defaults_unchanged();
}

#[test]
fn reopening_reads_changes_to_both_files() {
    let files = Files::new(USER);
    let config = files.open();
    fs::write(&files.defaults, DEFAULTS.replace("fade", "zoom")).unwrap();
    fs::write(&files.entry, USER.replace("500", "800")).unwrap();
    assert_eq!(config.get("wallpaper.duration").unwrap(), &json!(500));
    assert_eq!(config.get("wallpaper.transition").unwrap(), &json!("fade"));
    let config = files.open();
    assert_eq!(config.get("wallpaper.duration").unwrap(), &json!(800));
    assert_eq!(config.get("wallpaper.transition").unwrap(), &json!("zoom"));
}

#[test]
fn stale_root_edits_fail_until_reopened() {
    let files = Files::new(USER);
    let mut config = files.open();
    let external = USER.replace("500", "850");
    fs::write(&files.entry, &external).unwrap();
    assert!(matches!(
        config.set("wallpaper.duration", json!(900)),
        Err(Error::Conflict { .. })
    ));
    assert!(matches!(
        config.unset("wallpaper.duration"),
        Err(Error::Conflict { .. })
    ));
    assert_eq!(files.source(), external);
    config = files.open();
    config.set("wallpaper.duration", json!(900)).unwrap();
    assert_eq!(files.open().get("wallpaper.duration").unwrap(), &json!(900));
}

#[test]
fn set_recreates_a_deleted_entrypoint_with_only_the_requested_setting() {
    let files = Files::new(USER);
    let mut config = files.open();
    fs::remove_file(&files.entry).unwrap();

    config.set("wallpaper.duration", json!(900)).unwrap();
    assert_eq!(
        config.resolved().unwrap(),
        &json!({"wallpaper": {"duration": 900}})
    );
    assert_eq!(files.open().resolved().unwrap(), config.resolved().unwrap());
    let source = files.source();
    assert!(!source.contains("include"));
    assert!(!source.contains("unrelated"));
    assert!(!source.contains("/usr/share/wallpapers/default.jpg"));
    files.assert_defaults_unchanged();
}

#[test]
fn opening_a_missing_file_creates_an_empty_file_and_its_parent_directories() {
    let dir = tempfile::tempdir().unwrap();
    let entry = dir.path().join("nested/config/config.conf");

    let config = Config::open(&entry).unwrap();
    assert_eq!(config.resolved().unwrap(), &json!({}));
    assert_eq!(config.to_json().unwrap(), "{}");
    assert_eq!(config.get("wallpaper.duration").unwrap(), &Value::Null);
    assert!(entry.is_file());
    assert_eq!(fs::read_to_string(&entry).unwrap(), "");
    assert_eq!(fs::read_dir(entry.parent().unwrap()).unwrap().count(), 1);
}

#[test]
fn set_and_unset_work_on_a_file_created_by_open() {
    let dir = tempfile::tempdir().unwrap();
    let entry = dir.path().join("nested/config/config.conf");
    let mut config = Config::open(&entry).unwrap();

    config.set("wallpaper.duration", json!(600)).unwrap();
    assert!(entry.is_file());
    assert_eq!(config.get("wallpaper.duration").unwrap(), &json!(600));
    let reopened = Config::open(&entry).unwrap();
    assert_eq!(
        reopened.resolved().unwrap(),
        &json!({"wallpaper": {"duration": 600}})
    );
    assert_eq!(fs::read_dir(entry.parent().unwrap()).unwrap().count(), 1);

    config
        .set("wallpaper.path", json!("/wallpaper.jpg"))
        .unwrap();
    assert_eq!(config.get("wallpaper.duration").unwrap(), &json!(600));
    assert_eq!(
        Config::open(&entry).unwrap().get("wallpaper.path").unwrap(),
        &json!("/wallpaper.jpg")
    );
    config.unset("wallpaper.duration").unwrap();
    assert_eq!(config.get("wallpaper.duration").unwrap(), &Value::Null);
    assert_eq!(
        Config::open(&entry).unwrap().get("wallpaper.path").unwrap(),
        &json!("/wallpaper.jpg")
    );
}

#[test]
fn unset_of_a_missing_key_leaves_a_newly_created_file_empty() {
    let dir = tempfile::tempdir().unwrap();
    let entry = dir.path().join("nested/config/config.conf");
    let mut config = Config::open(&entry).unwrap();

    config.unset("wallpaper.duration").unwrap();
    assert_eq!(config.resolved().unwrap(), &json!({}));
    assert_eq!(fs::read_to_string(&entry).unwrap(), "");
    assert_eq!(fs::read_dir(entry.parent().unwrap()).unwrap().count(), 1);
}

#[test]
fn unset_does_not_recreate_a_deleted_entrypoint() {
    let files = Files::new(USER);
    let mut config = files.open();
    fs::remove_file(&files.entry).unwrap();

    config.unset("wallpaper.duration").unwrap();
    assert!(!files.entry.exists());
    files.assert_defaults_unchanged();
}

#[test]
fn invalid_paths_leave_a_newly_created_file_empty() {
    let dir = tempfile::tempdir().unwrap();
    let entry = dir.path().join("nested/config/config.conf");
    let mut config = Config::open(&entry).unwrap();

    for path in [
        "",
        ".wallpaper",
        "wallpaper.",
        "wallpaper..duration",
        "missing..key",
    ] {
        assert!(matches!(
            config.set(path, json!(1)),
            Err(Error::InvalidPath { .. })
        ));
        assert!(matches!(config.unset(path), Err(Error::InvalidPath { .. })));
    }
    assert_eq!(fs::read_to_string(&entry).unwrap(), "");
    assert_eq!(fs::read_dir(entry.parent().unwrap()).unwrap().count(), 1);
}

#[test]
fn an_empty_file_changed_since_open_is_preserved_and_reported_as_a_conflict() {
    let dir = tempfile::tempdir().unwrap();
    let entry = dir.path().join("config.conf");
    let mut config = Config::open(&entry).unwrap();
    let external = "created_elsewhere = true\n";
    fs::write(&entry, external).unwrap();

    assert!(matches!(
        config.set("wallpaper.duration", json!(600)),
        Err(Error::Conflict { .. })
    ));
    assert!(matches!(
        config.unset("created_elsewhere"),
        Err(Error::Conflict { .. })
    ));
    assert_eq!(fs::read_to_string(&entry).unwrap(), external);
    assert_eq!(config.resolved().unwrap(), &json!({}));
}

#[test]
fn concurrent_opens_create_one_file_and_preserve_existing_settings() {
    use std::{sync::Barrier, thread};

    let dir = tempfile::tempdir().unwrap();
    let entry = dir.path().join("nested/config.conf");
    let barrier = Barrier::new(8);
    thread::scope(|scope| {
        for _ in 0..8 {
            scope.spawn(|| {
                barrier.wait();
                assert_eq!(
                    Config::open(&entry).unwrap().resolved().unwrap(),
                    &json!({})
                );
            });
        }
    });
    assert_eq!(fs::read_to_string(&entry).unwrap(), "");
    assert_eq!(fs::read_dir(entry.parent().unwrap()).unwrap().count(), 1);

    Config::open(&entry)
        .unwrap()
        .set("wallpaper.duration", json!(600))
        .unwrap();
    let source = fs::read_to_string(&entry).unwrap();
    thread::scope(|scope| {
        for _ in 0..8 {
            scope.spawn(|| {
                barrier.wait();
                assert_eq!(
                    Config::open(&entry)
                        .unwrap()
                        .get("wallpaper.duration")
                        .unwrap(),
                    &json!(600)
                );
            });
        }
    });
    assert_eq!(fs::read_to_string(&entry).unwrap(), source);
}

#[test]
fn opening_a_file_under_a_regular_file_returns_an_io_error() {
    let dir = tempfile::tempdir().unwrap();
    let parent = dir.path().join("not_a_directory");
    fs::write(&parent, "keep this file").unwrap();

    assert!(matches!(
        Config::open(parent.join("config.conf")),
        Err(Error::Io { .. })
    ));
    assert_eq!(fs::read_to_string(&parent).unwrap(), "keep this file");
}

#[test]
fn invalid_paths_return_errors_without_changing_files() {
    let files = Files::new(USER);
    let mut config = files.open();
    for path in [
        "",
        ".wallpaper",
        "wallpaper.",
        "wallpaper..duration",
        "missing..key",
    ] {
        assert!(matches!(config.get(path), Err(Error::InvalidPath { .. })));
        assert!(matches!(
            config.set(path, json!(1)),
            Err(Error::InvalidPath { .. })
        ));
        assert!(matches!(config.unset(path), Err(Error::InvalidPath { .. })));
    }
    assert_eq!(files.source(), USER);
    files.assert_defaults_unchanged();
}

#[test]
fn parse_and_required_include_errors_are_reported() {
    let files = Files::new("broken {\n");
    assert!(matches!(
        Config::open(&files.entry),
        Err(Error::Parse { .. })
    ));
    fs::write(&files.entry, "include required(file(\"missing.conf\"))\n").unwrap();
    assert!(matches!(
        Config::open(&files.entry),
        Err(Error::Parse { .. })
    ));
}

#[test]
fn a_missing_optional_include_is_allowed_by_hocon() {
    let files = Files::new("include file(\"missing.conf\")\nvalue = 1\n");
    assert_eq!(files.open().get("value").unwrap(), &json!(1));
}

#[test]
fn resolution_failure_during_edit_leaves_root_unchanged() {
    let source = "include required(file(\"defaults.conf\"))\nwallpaper.duration = 500\n";
    let files = Files::new(source);
    let mut config = files.open();
    fs::remove_file(&files.defaults).unwrap();
    assert!(config.set("wallpaper.duration", json!(600)).is_err());
    assert_eq!(files.source(), source);
    assert_eq!(config.get("wallpaper.duration").unwrap(), &json!(500));
}

#[test]
fn unset_through_a_substitution_fails_without_rewriting_it() {
    let source = "base { duration = 500 }\nwallpaper = ${base}\n";
    let files = Files::new(source);
    let mut config = files.open();
    assert_eq!(config.get("wallpaper.duration").unwrap(), &json!(500));
    assert!(matches!(
        config.unset("wallpaper.duration"),
        Err(Error::Edit { .. })
    ));
    assert_eq!(files.source(), source);
}

#[test]
fn malformed_included_sources_fail_without_changing_loaded_values() {
    let files = Files::new("include required(file(\"defaults.conf\"))\n");
    let mut config = files.open();
    for malformed in [
        "broken {\n",
        "a = [1, 2\n",
        "a = \"unterminated",
        "a = ${missing",
        "a=1\nb",
        "a=\"\"\"hello\"\"\nb=2",
    ] {
        fs::write(&files.defaults, malformed).unwrap();
        assert!(
            matches!(Config::open(&files.entry), Err(Error::Parse { .. })),
            "{malformed}"
        );
        assert_eq!(config.get("wallpaper.duration").unwrap(), &json!(300));
        let source = files.source();
        assert!(config.set("new", json!(true)).is_err());
        assert_eq!(files.source(), source);
        assert_eq!(fs::read_dir(files.dir.path()).unwrap().count(), 2);
    }
}

#[test]
fn short_final_keys_and_nested_include_substitutions_are_resolved() {
    let files = Files::new("include file(\"defaults.conf\")\ni=1");
    fs::write(
        &files.defaults,
        "base=42\nwallpaper { include file(\"child.conf\") }\nid=2",
    )
    .unwrap();
    fs::write(
        files.dir.path().join("child.conf"),
        "duration=300\ncopy=${duration}\nin=3",
    )
    .unwrap();
    let mut config = files.open();
    assert_eq!(config.get("i").unwrap(), &json!(1));
    assert_eq!(config.get("id").unwrap(), &json!(2));
    assert_eq!(config.get("wallpaper.in").unwrap(), &json!(3));
    assert_eq!(config.get("wallpaper.copy").unwrap(), &json!(300));
    config.set("i", json!(4)).unwrap();
    assert_eq!(files.open().get("i").unwrap(), &json!(4));
    config.unset("i").unwrap();
    assert_eq!(config.get("i").unwrap(), &Value::Null);
}

#[test]
fn include_cycles_are_reported() {
    let files = Files::new("include required(file(\"defaults.conf\"))\n");
    fs::write(
        &files.defaults,
        "include required(file(\"./config.conf\"))\n",
    )
    .unwrap();
    assert!(matches!(
        Config::open(&files.entry),
        Err(Error::Parse { .. })
    ));
}

#[test]
fn successful_edits_leave_only_the_original_files() {
    let files = Files::new(USER);
    let mut config = files.open();
    config.set("wallpaper.duration", json!(900)).unwrap();
    config.unset("wallpaper.duration").unwrap();
    assert_eq!(fs::read_dir(files.dir.path()).unwrap().count(), 2);
    files.assert_defaults_unchanged();
}

#[cfg(unix)]
#[test]
fn atomic_edits_preserve_permissions_and_entrypoint_symlinks() {
    use std::os::unix::fs::{PermissionsExt, symlink};

    let files = Files::new(USER);
    fs::set_permissions(&files.entry, fs::Permissions::from_mode(0o640)).unwrap();
    let link = files.dir.path().join("entry.conf");
    symlink(&files.entry, &link).unwrap();
    let mut config = Config::open(&link).unwrap();
    config.set("wallpaper.duration", json!(950)).unwrap();
    assert!(fs::symlink_metadata(link).unwrap().is_symlink());
    assert_eq!(
        fs::metadata(&files.entry).unwrap().permissions().mode() & 0o777,
        0o640
    );
    assert_eq!(files.open().get("wallpaper.duration").unwrap(), &json!(950));
    files.assert_defaults_unchanged();
}
