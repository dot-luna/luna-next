use std::{
    fs,
    os::unix::fs::{PermissionsExt, symlink},
    path::{Path, PathBuf},
    process::Command,
};

use luna_next::install::{Report, configure_installed_apps, install_app_configs};
use serde_json::{Value, json};

// Isolate environment changes and the working directory from parallel test cases.
fn scenario(name: &str) {
    let temporary = tempfile::Builder::new()
        .prefix("luna app configs '")
        .tempdir()
        .unwrap();
    let home = temporary.path().join("home");
    let repository = temporary.path().join("repository");
    fs::create_dir(&home).unwrap();
    fs::create_dir(&repository).unwrap();
    let output = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "app_config_scenario", "--nocapture"])
        .env("LUNA_APP_CONFIG_TEST_ROOT", temporary.path())
        .env("LUNA_APP_CONFIG_TEST_SCENARIO", name)
        .env("HOME", home)
        .env_remove("XDG_CONFIG_HOME")
        .env_remove("LUNA_TEST_APP_CONFIG")
        .env("PATH", "")
        .current_dir(repository)
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
        let root = PathBuf::from(std::env::var_os("LUNA_APP_CONFIG_TEST_ROOT").unwrap());
        Self {
            repository: root.join("repository"),
            config: root.join("home/.config"),
            root,
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

    fn install(&self, names: &[&str]) -> luna_next::Result<Report> {
        install_app_configs(
            &self.repository,
            &names.iter().map(|name| (*name).into()).collect::<Vec<_>>(),
        )
    }

    fn configure_installed(&self, names: &[&str]) -> luna_next::Result<Report> {
        configure_installed_apps(
            &self.repository,
            &names.iter().map(|name| (*name).into()).collect::<Vec<_>>(),
        )
    }

    fn target(&self, path: &str) -> PathBuf {
        self.config.join(path)
    }
}

fn write(path: impl AsRef<Path>, contents: impl AsRef<[u8]>) {
    let path = path.as_ref();
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, contents).unwrap();
}

#[test]
fn app_configs_copy_files_and_companions_with_permissions_in_sorted_order() {
    scenario("copy");
}

#[test]
fn existing_config_files_and_symlinks_are_replaced_on_reinstall() {
    scenario("replace");
}

#[test]
fn app_commands_build_staged_configs_from_templates_without_editing_sources() {
    scenario("builder");
}

#[test]
fn failed_builds_and_missing_exports_do_not_publish_any_config_for_the_app() {
    scenario("failure");
}

#[test]
fn invalid_app_paths_and_unknown_names_cannot_escape_or_publish() {
    scenario("validation");
}

#[test]
fn config_destinations_honor_xdg_and_explicit_file_environment_overrides() {
    scenario("environment");
}

#[test]
fn file_exports_replace_existing_directory_targets() {
    scenario("replace_directory");
}

#[test]
fn missing_apps_are_an_empty_selection_unless_a_name_was_requested() {
    scenario("missing");
}

#[test]
fn installed_package_names_select_generic_app_mappings_and_ignore_unknown_packages() {
    scenario("package_selection");
}

#[test]
fn managed_defaults_create_resolvable_user_includes_and_respect_file_environment() {
    scenario("managed_publish");
}

#[test]
fn managed_defaults_rebuild_and_reset_user_entries_on_reinstall() {
    scenario("managed_refresh");
}

#[test]
fn failed_managed_builds_and_missing_exports_preserve_installed_defaults_and_users() {
    scenario("managed_failure");
}

#[test]
fn managed_defaults_replace_leaf_links_but_reject_source_aliases_and_overlapping_targets() {
    scenario("managed_conflicts");
}

#[test]
fn app_config_scenario() {
    let Ok(scenario) = std::env::var("LUNA_APP_CONFIG_TEST_SCENARIO") else {
        return;
    };
    let fixture = Fixture::new();
    match scenario.as_str() {
        "package_selection" => {
            let panel = fixture.app(
                "panel-config",
                json!({"package": "panel", "exports": [
                    {"source": "main.conf", "target": "panel/main.conf"}
                ]}),
            );
            write(panel.join("config/main.conf"), "panel = true\n");
            let editor = fixture.app(
                "editor",
                json!({"exports": [
                    {"source": "main.conf", "target": "editor/main.conf"}
                ]}),
            );
            write(editor.join("config/main.conf"), "editor = true\n");
            for names in [&[][..], &["not-an-app"][..], &["panel-config"][..]] {
                let report = fixture.configure_installed(names).unwrap();
                assert!(report.installed.is_empty());
                assert!(report.skipped.is_empty());
                assert!(!fixture.config.exists());
            }
            let report = fixture
                .configure_installed(&["panel", "not-an-app"])
                .unwrap();
            assert_eq!(report.installed, ["panel-config"]);
            assert_eq!(
                fs::read_to_string(fixture.target("panel/main.conf")).unwrap(),
                "panel = true\n"
            );
            assert!(!fixture.target("editor").exists());
            let report = fixture.configure_installed(&["editor"]).unwrap();
            assert_eq!(report.installed, ["editor"]);
            assert_eq!(
                fs::read_to_string(fixture.target("editor/main.conf")).unwrap(),
                "editor = true\n"
            );
        }
        "managed_publish" => {
            let app = fixture.app(
                "dashboard",
                json!({"exports": [{
                    "source": "main.conf",
                    "target": "dashboard/user.conf",
                    "defaults": "dashboard/defaults.conf",
                    "file_env": "LUNA_TEST_APP_CONFIG"
                }]}),
            );
            let source = "theme { name = \"default\", duration = 300 }\n";
            write(app.join("config/main.conf"), source);
            let xdg = fixture.root.join("custom config");
            unsafe {
                std::env::set_var("XDG_CONFIG_HOME", &xdg);
            }
            let report = fixture.install(&["dashboard"]).unwrap();
            assert_eq!(report.installed, ["dashboard"]);
            let defaults = xdg.join("dashboard/defaults.conf");
            let user = xdg.join("dashboard/user.conf");
            let include = format!(
                "include required(file({}))\n",
                serde_json::to_string(defaults.to_str().unwrap()).unwrap()
            );
            assert_eq!(fs::read_to_string(&defaults).unwrap(), source);
            assert_eq!(fs::read_to_string(&user).unwrap(), include);
            assert_eq!(
                luna_next_hocon::load(&user).unwrap(),
                json!({"theme": {"name": "default", "duration": 300}})
            );
            let override_file = fixture.root.join("outside ' config/custom.conf");
            unsafe {
                std::env::set_var("LUNA_TEST_APP_CONFIG", &override_file);
            }
            fixture.install(&["dashboard"]).unwrap();
            assert_eq!(fs::read_to_string(&override_file).unwrap(), include);
            assert_eq!(fs::read_to_string(&user).unwrap(), include);
            write(&override_file, format!("{include}theme.duration = 600\n"));
            assert_eq!(
                luna_next_hocon::load(&override_file).unwrap(),
                json!({"theme": {"name": "default", "duration": 600}})
            );
            assert_eq!(
                std::env::var_os("LUNA_TEST_APP_CONFIG").unwrap(),
                override_file.as_os_str()
            );
            assert!(!fixture.config.exists());
            assert_eq!(
                fs::read_to_string(app.join("config/main.conf")).unwrap(),
                source
            );
        }
        "managed_refresh" => {
            let app = fixture.app(
                "generated",
                json!({
                    "command": [["/bin/sh", "-c", concat!(
                        "IFS= read -r value < templates/value; ",
                        "printf 'value = \"%s\"\\nversion = \"%s\"\\n' \"$value\" \"$value\" > \"$LUNA_CONFIG_OUTPUT/main.conf\"; ",
                        "printf x >> \"$LUNA_APP_DIR/build-count\""
                    )]],
                    "exports": [
                        {"source": "main.conf", "target": "generated/user.conf", "defaults": "generated/defaults.conf"},
                        {"source": "extra.conf", "target": "generated/extra.conf", "defaults": "generated/extra.defaults.conf"}
                    ]
                }),
            );
            write(app.join("templates/value"), "first\n");
            write(app.join("config/extra.conf"), "extra = true\n");
            fixture.install(&["generated"]).unwrap();
            let user = fixture.target("generated/user.conf");
            let original = fs::read_to_string(&user).unwrap();
            let edited = format!("{original}value = \"personal\"\n");
            write(&user, &edited);
            let symlink_target = fixture.root.join("not-created.conf");
            let extra = fixture.target("generated/extra.conf");
            fs::remove_file(&extra).unwrap();
            symlink(&symlink_target, &extra).unwrap();
            write(app.join("templates/value"), "second\n");
            write(app.join("config/extra.conf"), "extra = false\n");
            let report = fixture.install(&["generated"]).unwrap();
            assert_eq!(report.installed, ["generated"]);
            assert_eq!(fs::read_to_string(&user).unwrap(), original);
            assert!(!fs::symlink_metadata(&extra).unwrap().is_symlink());
            let extra_defaults = fixture.target("generated/extra.defaults.conf");
            assert_eq!(
                fs::read_to_string(&extra).unwrap(),
                format!(
                    "include required(file({}))\n",
                    serde_json::to_string(extra_defaults.to_str().unwrap()).unwrap()
                )
            );
            assert!(!symlink_target.exists());
            assert_eq!(
                luna_next_hocon::load(&user).unwrap(),
                json!({"value": "second", "version": "second"})
            );
            assert_eq!(
                fs::read_to_string(fixture.target("generated/extra.defaults.conf")).unwrap(),
                "extra = false\n"
            );
            assert_eq!(fs::read_to_string(app.join("build-count")).unwrap(), "xx");
            assert!(!app.join("config/main.conf").exists());
        }
        "managed_conflicts" => {
            for (name, defaults) in [
                ("same-target", "same-target/user.conf"),
                ("symlink", "symlink/defaults.conf"),
                ("source-alias", "source-alias/source/main.conf"),
            ] {
                let app = fixture.app(
                    name,
                    json!({
                        "command": [["/bin/sh", "-c", "printf ran > \"$LUNA_APP_DIR/builder-ran\""]],
                        "exports": [{
                            "source": "main.conf",
                            "target": format!("{name}/user.conf"),
                            "defaults": defaults
                        }]
                    }),
                );
                let source = app.join("config/main.conf");
                write(&source, "value = \"source\"\n");
                let user = fixture.target(&format!("{name}/user.conf"));
                write(&user, "value = \"personal\"\n");
                let external = fixture.root.join("external-defaults.conf");
                if name == "symlink" {
                    write(&external, "value = \"external\"\n");
                    symlink(&external, fixture.target(defaults)).unwrap();
                } else if name == "source-alias" {
                    symlink(app.join("config"), fixture.target("source-alias/source")).unwrap();
                }
                if name == "symlink" {
                    fixture.install(&[name]).unwrap();
                    assert!(app.join("builder-ran").exists());
                    assert!(
                        !fs::symlink_metadata(fixture.target(defaults))
                            .unwrap()
                            .is_symlink()
                    );
                    assert_eq!(
                        luna_next_hocon::load(&user).unwrap(),
                        json!({"value": "source"})
                    );
                    assert_eq!(
                        fs::read_to_string(&external).unwrap(),
                        "value = \"external\"\n"
                    );
                } else {
                    assert!(fixture.install(&[name]).is_err(), "{name}");
                    assert_eq!(fs::read_to_string(&user).unwrap(), "value = \"personal\"\n");
                    assert!(!app.join("builder-ran").exists(), "{name}");
                    if name == "source-alias" {
                        assert_eq!(
                            fs::read_link(fixture.target("source-alias/source")).unwrap(),
                            app.join("config")
                        );
                    }
                }
                assert_eq!(fs::read_to_string(&source).unwrap(), "value = \"source\"\n");
            }
        }
        "managed_failure" => {
            for (name, command) in [
                ("failing", json!([["/bin/sh", "-c", "exit 23"]])),
                ("missing", json!([])),
            ] {
                let app = fixture.app(
                    name,
                    json!({"command": command, "exports": [
                        {"source": "main.conf", "target": format!("{name}/user.conf"), "defaults": format!("{name}/defaults.conf")},
                        {"source": "not-generated.conf", "target": format!("{name}/extra.conf"), "defaults": format!("{name}/extra.defaults.conf")}
                    ]}),
                );
                write(app.join("config/main.conf"), "value = \"new\"\n");
                let defaults = fixture.target(&format!("{name}/defaults.conf"));
                let user = fixture.target(&format!("{name}/user.conf"));
                write(&defaults, "value = \"old\"\n");
                let include = format!(
                    "include required(file({}))\ncustom = true\n",
                    serde_json::to_string(defaults.to_str().unwrap()).unwrap()
                );
                write(&user, &include);
                let error = fixture.install(&[name]).unwrap_err().to_string();
                if name == "failing" {
                    assert!(error.contains("23"), "{error}");
                }
                assert_eq!(fs::read_to_string(&defaults).unwrap(), "value = \"old\"\n");
                assert_eq!(fs::read_to_string(&user).unwrap(), include);
                assert!(!fixture.target(&format!("{name}/extra.conf")).exists());
                assert!(
                    !fixture
                        .target(&format!("{name}/extra.defaults.conf"))
                        .exists()
                );
                assert_eq!(
                    fs::read_to_string(app.join("config/main.conf")).unwrap(),
                    "value = \"new\"\n"
                );
            }
        }
        "copy" => {
            let alpha = fixture.app(
                "alpha",
                json!({"exports": [
                    {"source": "main.conf", "target": "alpha/main.conf"},
                    {"source": "nested/helper.conf", "target": "alpha/nested/helper.conf"}
                ]}),
            );
            write(
                alpha.join("config/main.conf"),
                b"# keep formatting\nvalue = 12\n",
            );
            write(
                alpha.join("config/nested/helper.conf"),
                b"companion\0bytes\n",
            );
            fs::set_permissions(
                alpha.join("config/nested/helper.conf"),
                fs::Permissions::from_mode(0o640),
            )
            .unwrap();
            let zeta = fixture.app(
                "zeta",
                json!({"config": "defaults", "exports": [
                    {"source": "zeta.conf", "target": "zeta.conf"}
                ]}),
            );
            write(zeta.join("defaults/zeta.conf"), "zeta = true\n");
            fs::create_dir(fixture.repository.join("apps/not-an-app")).unwrap();
            let report = fixture.install(&[]).unwrap();
            assert_eq!(report.installed, ["alpha", "zeta"]);
            assert!(report.skipped.is_empty());
            assert_eq!(
                fs::read(fixture.target("alpha/main.conf")).unwrap(),
                b"# keep formatting\nvalue = 12\n"
            );
            assert_eq!(
                fs::read(fixture.target("alpha/nested/helper.conf")).unwrap(),
                b"companion\0bytes\n"
            );
            assert_eq!(
                fs::metadata(fixture.target("alpha/nested/helper.conf"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o640
            );
            assert_eq!(
                fs::read_to_string(fixture.target("zeta.conf")).unwrap(),
                "zeta = true\n"
            );
            assert!(
                !fs::symlink_metadata(fixture.target("alpha/main.conf"))
                    .unwrap()
                    .is_symlink()
            );
            assert_eq!(
                fs::read(alpha.join("config/nested/helper.conf")).unwrap(),
                b"companion\0bytes\n"
            );
        }
        "replace" => {
            let app = fixture.app(
                "sample",
                json!({"exports": [
                    {"source": "one.conf", "target": "sample/one.conf"},
                    {"source": "two.conf", "target": "sample/two.conf"},
                    {"source": "three.conf", "target": "sample/three.conf"}
                ]}),
            );
            for name in ["one", "two", "three"] {
                write(app.join(format!("config/{name}.conf")), "default");
            }
            fixture.install(&["sample"]).unwrap();
            write(fixture.target("sample/one.conf"), "user edits\n");
            let external = fixture.root.join("external.conf");
            write(&external, "external edits\n");
            fs::remove_file(fixture.target("sample/two.conf")).unwrap();
            symlink(&external, fixture.target("sample/two.conf")).unwrap();
            let missing = fixture.root.join("not-created.conf");
            fs::remove_file(fixture.target("sample/three.conf")).unwrap();
            symlink(&missing, fixture.target("sample/three.conf")).unwrap();
            fixture.install(&["sample"]).unwrap();
            for name in ["one", "two", "three"] {
                let target = fixture.target(&format!("sample/{name}.conf"));
                assert_eq!(fs::read_to_string(&target).unwrap(), "default");
                assert!(!fs::symlink_metadata(target).unwrap().is_symlink());
            }
            assert_eq!(fs::read_to_string(&external).unwrap(), "external edits\n");
            assert!(!missing.exists());
        }
        "builder" => {
            let app = fixture.app(
                "generated",
                json!({
                    "command": [["/bin/sh", "-c", concat!(
                        "[ \"$PWD\" = \"$LUNA_APP_DIR\" ] || exit 7; ",
                        "IFS= read -r value < templates/value; ",
                        "printf 'value = \"%s\"\\n' \"$value\" > \"$LUNA_CONFIG_OUTPUT/generated.conf\""
                    )]],
                    "exports": [
                        {"source": "generated.conf", "target": "generated.conf"},
                        {"source": "static.conf", "target": "static.conf"}
                    ]
                }),
            );
            write(app.join("templates/value"), "rendered from template\n");
            write(app.join("config/static.conf"), "static = true\n");
            fixture.install(&["generated"]).unwrap();
            assert_eq!(
                fs::read_to_string(fixture.target("generated.conf")).unwrap(),
                "value = \"rendered from template\"\n"
            );
            assert_eq!(
                fs::read_to_string(fixture.target("static.conf")).unwrap(),
                "static = true\n"
            );
            assert!(!app.join("config/generated.conf").exists());
            assert_eq!(
                fs::read_to_string(app.join("templates/value")).unwrap(),
                "rendered from template\n"
            );
        }
        "failure" => {
            for (name, command) in [
                ("failing", json!([["/bin/sh", "-c", "exit 23"]])),
                ("missing", json!([])),
            ] {
                let app = fixture.app(
                    name,
                    json!({"command": command, "exports": [
                        {"source": "static.conf", "target": format!("{name}/static.conf")},
                        {"source": "not-generated.conf", "target": format!("{name}/generated.conf")}
                    ]}),
                );
                write(app.join("config/static.conf"), "static\n");
                let error = fixture.install(&[name]).unwrap_err().to_string();
                if name == "failing" {
                    assert!(error.contains("23"), "{error}");
                }
                assert!(!fixture.target(name).exists());
                assert!(!app.join("config/not-generated.conf").exists());
                assert_eq!(
                    fs::read_to_string(app.join("config/static.conf")).unwrap(),
                    "static\n"
                );
            }
        }
        "validation" => {
            let outside = fixture.repository.join("outside.conf");
            write(&outside, "outside\n");
            for (name, descriptor) in [
                (
                    "source-escape",
                    json!({"exports": [
                        {"source": "static.conf", "target": "first.conf"},
                        {"source": "../outside.conf", "target": "escaped.conf"}
                    ]}),
                ),
                (
                    "target-escape",
                    json!({"exports": [
                        {"source": "static.conf", "target": "first.conf"},
                        {"source": "static.conf", "target": "../escaped.conf"}
                    ]}),
                ),
                (
                    "config-escape",
                    json!({"config": "../..", "exports": [
                        {"source": "outside.conf", "target": "escaped.conf"}
                    ]}),
                ),
            ] {
                let app = fixture.app(name, descriptor);
                write(app.join("config/static.conf"), "static\n");
                write(app.join("outside.conf"), "outside app config\n");
                assert!(fixture.install(&[name]).is_err(), "{name}");
                assert!(!fixture.config.exists(), "{name}");
            }
            assert!(fixture.install(&["does-not-exist"]).is_err());
            assert!(fixture.install(&["../outside"]).is_err());
            assert!(!fixture.config.exists());
            assert_eq!(fs::read_to_string(outside).unwrap(), "outside\n");
        }
        "environment" => {
            let app = fixture.app(
                "sample",
                json!({"exports": [
                    {"source": "ordinary.conf", "target": "sample/ordinary.conf"},
                    {"source": "special.conf", "target": "sample/special.conf", "file_env": "LUNA_TEST_APP_CONFIG"}
                ]}),
            );
            write(app.join("config/ordinary.conf"), "ordinary\n");
            write(app.join("config/special.conf"), "special\n");
            unsafe {
                std::env::set_var("XDG_CONFIG_HOME", "relative-config");
            }
            assert!(fixture.install(&["sample"]).is_err());
            assert!(!fixture.repository.join("relative-config").exists());
            let xdg = fixture.root.join("custom config");
            let override_file = fixture.root.join("overrides/special.conf");
            unsafe {
                std::env::set_var("XDG_CONFIG_HOME", &xdg);
                std::env::set_var("LUNA_TEST_APP_CONFIG", &override_file);
            }
            fixture.install(&["sample"]).unwrap();
            assert_eq!(
                fs::read_to_string(xdg.join("sample/ordinary.conf")).unwrap(),
                "ordinary\n"
            );
            assert_eq!(fs::read_to_string(&override_file).unwrap(), "special\n");
            assert!(!xdg.join("sample/special.conf").exists());
            assert!(!fixture.config.exists());
            unsafe {
                std::env::set_var("LUNA_TEST_APP_CONFIG", "../relative/special.conf");
            }
            fixture.install(&["sample"]).unwrap();
            assert_eq!(
                fs::read_to_string(fixture.root.join("relative/special.conf")).unwrap(),
                "special\n"
            );
            unsafe {
                std::env::set_var("XDG_CONFIG_HOME", "");
                std::env::set_var("LUNA_TEST_APP_CONFIG", "");
            }
            fixture.install(&["sample"]).unwrap();
            assert_eq!(
                fs::read_to_string(fixture.target("sample/ordinary.conf")).unwrap(),
                "ordinary\n"
            );
            assert_eq!(
                fs::read_to_string(fixture.target("sample/special.conf")).unwrap(),
                "special\n"
            );
        }
        "replace_directory" => {
            let app = fixture.app(
                "sample",
                json!({"exports": [
                    {"source": "one.conf", "target": "sample/one.conf"},
                    {"source": "two.conf", "target": "sample/two.conf"}
                ]}),
            );
            write(app.join("config/one.conf"), "one\n");
            write(app.join("config/two.conf"), "two\n");
            fs::create_dir_all(fixture.target("sample/two.conf")).unwrap();
            write(fixture.target("sample/two.conf/keep"), "keep\n");
            fixture.install(&["sample"]).unwrap();
            assert_eq!(
                fs::read_to_string(fixture.target("sample/one.conf")).unwrap(),
                "one\n"
            );
            assert_eq!(
                fs::read_to_string(fixture.target("sample/two.conf")).unwrap(),
                "two\n"
            );
        }
        "missing" => {
            let report = fixture.install(&[]).unwrap();
            assert!(report.installed.is_empty());
            assert!(report.skipped.is_empty());
            assert!(!fixture.config.exists());
            assert!(fixture.install(&["wallpaper"]).is_err());
            assert!(!fixture.config.exists());
        }
        _ => panic!("unknown app config scenario: {scenario}"),
    }
}
