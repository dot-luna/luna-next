use std::{
    fs,
    os::unix::fs::{PermissionsExt, symlink},
    path::{Path, PathBuf},
    process::Command,
};

use luna_next::install::{Report, install_app_configs};
use serde_json::{Value, json};

// Each child owns its HOME and environment; concurrent scenarios never publish into real configs.
fn scenario(name: &str) {
    let temporary = tempfile::tempdir().unwrap();
    let home = temporary.path().join("home");
    fs::create_dir(&home).unwrap();
    let output = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "folder_scenario", "--nocapture"])
        .env_clear()
        .env("HOME", home)
        .env("PATH", "/usr/bin:/bin")
        .env("LUNA_FOLDER_TEST_ROOT", temporary.path())
        .env("LUNA_FOLDER_TEST_SCENARIO", name)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{name}:\n{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

struct Fixture {
    root: PathBuf,
    repository: PathBuf,
    config: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let root = PathBuf::from(std::env::var_os("LUNA_FOLDER_TEST_ROOT").unwrap());
        let repository = root.join("repository");
        fs::create_dir(&repository).unwrap();
        Self {
            config: root.join("home/.config"),
            root,
            repository,
        }
    }

    fn app(&self, name: &str, descriptor: Value) -> PathBuf {
        let app = self.repository.join("apps").join(name);
        fs::create_dir_all(app.join("config")).unwrap();
        fs::write(
            app.join("app.conf"),
            serde_json::to_vec(&descriptor).unwrap(),
        )
        .unwrap();
        app
    }

    fn install(&self, name: &str) -> luna_next::Result<Report> {
        install_app_configs(&self.repository, &[name.into()])
    }
}

fn write(path: impl AsRef<Path>, contents: &str) {
    let path = path.as_ref();
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, contents).unwrap();
}

#[test]
fn root_and_nested_folder_exports_copy_contents_recursively_with_file_modes() {
    scenario("folders");
}

#[test]
fn configuring_replaces_the_entire_exported_tree_without_backups() {
    scenario("replace");
}

#[test]
fn symlink_destinations_are_replaced_without_touching_their_external_targets() {
    scenario("symlinks");
}

#[test]
fn file_exports_and_folders_replace_old_destination_types() {
    scenario("types");
}

#[test]
fn builders_generate_folder_exports_and_respect_destination_environment() {
    scenario("builder");
}

#[test]
fn invalid_generated_tree_entries_are_rejected_before_any_app_export_is_written() {
    scenario("unsafe_sources");
}

#[test]
fn folder_exports_reject_managed_defaults_before_any_app_export_is_written() {
    scenario("defaults");
}

#[test]
fn overlapping_exports_and_source_tree_destinations_are_rejected_before_writing() {
    scenario("overlap");
}

#[test]
fn folder_scenario() {
    let Ok(scenario) = std::env::var("LUNA_FOLDER_TEST_SCENARIO") else {
        return;
    };
    let fixture = Fixture::new();
    match scenario.as_str() {
        "folders" => {
            let app = fixture.app(
                "root",
                json!({"exports": [{"source": ".", "target": "luna-next/hypr"}]}),
            );
            write(app.join("config/hyprland.lua"), "return {}\n");
            let helper = app.join("config/plugins/helper.sh");
            write(&helper, "#!/bin/sh\nexit 0\n");
            fs::set_permissions(&helper, fs::Permissions::from_mode(0o750)).unwrap();
            fs::create_dir(app.join("config/empty")).unwrap();
            fixture.install("root").unwrap();
            let target = fixture.config.join("luna-next/hypr");
            assert_eq!(
                fs::read_to_string(target.join("hyprland.lua")).unwrap(),
                "return {}\n"
            );
            assert!(target.join("empty").is_dir());
            assert_eq!(
                fs::metadata(target.join("plugins/helper.sh"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o750
            );
            let nested = fixture.app(
                "nested",
                json!({"exports": [{"source": "nested/folder", "target": "nested"}]}),
            );
            write(nested.join("config/nested/folder/file.conf"), "inside\n");
            write(nested.join("config/not-exported.conf"), "outside\n");
            fixture.install("nested").unwrap();
            assert_eq!(
                fs::read_to_string(fixture.config.join("nested/file.conf")).unwrap(),
                "inside\n"
            );
            assert!(!fixture.config.join("nested/not-exported.conf").exists());
        }
        "replace" => {
            let app = fixture.app(
                "sample",
                json!({"exports": [{"source": ".", "target": "sample"}]}),
            );
            write(app.join("config/one.conf"), "first\n");
            write(app.join("config/sub/old.conf"), "old\n");
            fixture.install("sample").unwrap();
            let target = fixture.config.join("sample");
            write(target.join("one.conf"), "personal\n");
            write(target.join("unrelated.conf"), "old export extra\n");
            let external = fixture.root.join("external");
            write(external.join("keep.conf"), "outside\n");
            symlink(&external, target.join("external")).unwrap();
            write(app.join("config/one.conf"), "second\n");
            fs::remove_file(app.join("config/sub/old.conf")).unwrap();
            write(app.join("config/sub/new.conf"), "new\n");
            let report = fixture.install("sample").unwrap();
            assert_eq!(report.installed, ["sample"]);
            assert!(report.skipped.is_empty());
            assert_eq!(
                fs::read_to_string(target.join("one.conf")).unwrap(),
                "second\n"
            );
            assert_eq!(
                fs::read_to_string(target.join("sub/new.conf")).unwrap(),
                "new\n"
            );
            assert!(!target.join("sub/old.conf").exists());
            assert!(!target.join("unrelated.conf").exists());
            assert!(!target.join("external").exists());
            assert_eq!(
                fs::read_to_string(external.join("keep.conf")).unwrap(),
                "outside\n"
            );
            assert_eq!(fs::read_dir(&fixture.config).unwrap().count(), 1);
        }
        "symlinks" => {
            let app = fixture.app(
                "sample",
                json!({"exports": [
                    {"source": "folder", "target": "folder"},
                    {"source": "file.conf", "target": "file.conf"}
                ]}),
            );
            write(app.join("config/folder/nested.conf"), "new nested\n");
            write(app.join("config/file.conf"), "new file\n");
            let external = fixture.root.join("external");
            write(external.join("nested.conf"), "external nested\n");
            write(external.join("file.conf"), "external file\n");
            fs::create_dir_all(&fixture.config).unwrap();
            symlink(&external, fixture.config.join("folder")).unwrap();
            symlink(external.join("file.conf"), fixture.config.join("file.conf")).unwrap();
            fixture.install("sample").unwrap();
            assert!(
                !fs::symlink_metadata(fixture.config.join("folder"))
                    .unwrap()
                    .is_symlink()
            );
            assert!(
                !fs::symlink_metadata(fixture.config.join("file.conf"))
                    .unwrap()
                    .is_symlink()
            );
            assert_eq!(
                fs::read_to_string(fixture.config.join("folder/nested.conf")).unwrap(),
                "new nested\n"
            );
            assert_eq!(
                fs::read_to_string(fixture.config.join("file.conf")).unwrap(),
                "new file\n"
            );
            assert_eq!(
                fs::read_to_string(external.join("nested.conf")).unwrap(),
                "external nested\n"
            );
            assert_eq!(
                fs::read_to_string(external.join("file.conf")).unwrap(),
                "external file\n"
            );
        }
        "types" => {
            let app = fixture.app(
                "sample",
                json!({"exports": [
                    {"source": "folder", "target": "folder"},
                    {"source": "file.conf", "target": "file.conf"}
                ]}),
            );
            write(app.join("config/folder/nested.conf"), "folder\n");
            write(app.join("config/file.conf"), "file\n");
            write(fixture.config.join("folder"), "stale file\n");
            write(fixture.config.join("file.conf/stale.conf"), "stale tree\n");
            fixture.install("sample").unwrap();
            assert_eq!(
                fs::read_to_string(fixture.config.join("folder/nested.conf")).unwrap(),
                "folder\n"
            );
            assert_eq!(
                fs::read_to_string(fixture.config.join("file.conf")).unwrap(),
                "file\n"
            );
        }
        "builder" => {
            let app = fixture.app(
                "generated",
                json!({
                    "command": [["/bin/sh", "-c", concat!(
                        "mkdir -p \"$LUNA_CONFIG_OUTPUT/generated/sub\"; ",
                        "IFS= read -r value < templates/value; ",
                        "printf '%s\\n' \"$value\" > \"$LUNA_CONFIG_OUTPUT/generated/sub/result.conf\"; ",
                        "printf shared > \"$LUNA_CONFIG_OUTPUT/shared.conf\"; ",
                        "ln -s \"$LUNA_CONFIG_OUTPUT/shared.conf\" \"$LUNA_CONFIG_OUTPUT/generated/sub/alias.conf\"; ",
                        "printf x >> \"$LUNA_APP_DIR/build-count\""
                    )]],
                    "exports": [{"source": "generated", "target": "default", "file_env": "LUNA_FOLDER_DESTINATION"}]
                }),
            );
            write(app.join("templates/value"), "first\n");
            let target = fixture.root.join("custom destination");
            unsafe {
                std::env::set_var("LUNA_FOLDER_DESTINATION", &target);
            }
            fixture.install("generated").unwrap();
            write(app.join("templates/value"), "second\n");
            fixture.install("generated").unwrap();
            assert_eq!(
                fs::read_to_string(target.join("sub/result.conf")).unwrap(),
                "second\n"
            );
            assert_eq!(
                fs::read_to_string(target.join("sub/alias.conf")).unwrap(),
                "shared"
            );
            assert!(
                !fs::symlink_metadata(target.join("sub/alias.conf"))
                    .unwrap()
                    .is_symlink()
            );
            assert_eq!(fs::read_to_string(app.join("build-count")).unwrap(), "xx");
            assert!(!fixture.config.exists());
            assert!(!app.join("config/generated").exists());
        }
        "unsafe_sources" => {
            let external = fixture.root.join("external.conf");
            write(&external, "external\n");
            for (name, command) in [
                (
                    "escape",
                    "ln -s \"$LUNA_APP_DIR/../../../external.conf\" \"$LUNA_CONFIG_OUTPUT/tree/escape.conf\"",
                ),
                ("special", "mkfifo \"$LUNA_CONFIG_OUTPUT/tree/pipe\""),
                (
                    "directory-link",
                    "ln -s \"$LUNA_CONFIG_OUTPUT/tree\" \"$LUNA_CONFIG_OUTPUT/tree/self\"",
                ),
            ] {
                let app = fixture.app(
                    name,
                    json!({
                        "command": [["/bin/sh", "-c", command]],
                        "exports": [
                            {"source": "first.conf", "target": format!("{name}-first.conf")},
                            {"source": "tree", "target": name}
                        ]
                    }),
                );
                write(app.join("config/first.conf"), "new first\n");
                write(app.join("config/tree/valid.conf"), "valid\n");
                write(
                    fixture.config.join(format!("{name}-first.conf")),
                    "old first\n",
                );
                write(fixture.config.join(name).join("old.conf"), "old tree\n");
                assert!(fixture.install(name).is_err(), "{name}");
                assert_eq!(
                    fs::read_to_string(fixture.config.join(format!("{name}-first.conf"))).unwrap(),
                    "old first\n"
                );
                assert_eq!(
                    fs::read_to_string(fixture.config.join(name).join("old.conf")).unwrap(),
                    "old tree\n"
                );
            }
            assert_eq!(fs::read_to_string(external).unwrap(), "external\n");
        }
        "defaults" => {
            let app = fixture.app(
                "sample",
                json!({"exports": [
                    {"source": "file.conf", "target": "first.conf"},
                    {"source": ".", "target": "user.conf", "defaults": "defaults.conf"}
                ]}),
            );
            write(app.join("config/file.conf"), "new\n");
            write(fixture.config.join("first.conf"), "old\n");
            let error = fixture.install("sample").unwrap_err().to_string();
            assert!(error.contains("defaults require a file"), "{error}");
            assert_eq!(
                fs::read_to_string(fixture.config.join("first.conf")).unwrap(),
                "old\n"
            );
            assert!(!fixture.config.join("defaults.conf").exists());
            assert!(!fixture.config.join("user.conf").exists());
        }
        "overlap" => {
            for (name, target) in [
                ("overlap", fixture.config.join("shared/child.conf")),
                (
                    "source",
                    fixture.repository.join("apps/source/config/destroyed.conf"),
                ),
            ] {
                let app = fixture.app(name, json!({"exports": [
                    {"source": ".", "target": "shared"},
                    {"source": "file.conf", "target": "placeholder", "file_env": "LUNA_FOLDER_DESTINATION"}
                ]}));
                write(app.join("config/file.conf"), "source\n");
                unsafe {
                    std::env::set_var("LUNA_FOLDER_DESTINATION", target);
                }
                assert!(fixture.install(name).is_err(), "{name}");
                assert!(!fixture.config.exists());
                assert_eq!(
                    fs::read_to_string(app.join("config/file.conf")).unwrap(),
                    "source\n"
                );
            }
        }
        _ => panic!("unknown folder scenario: {scenario}"),
    }
}
