use serde_json::{Value, json};
use std::{
    fs,
    os::unix::fs::{PermissionsExt, symlink},
    path::{Path, PathBuf},
    process::{Command, Output},
};

struct Sandbox {
    root: tempfile::TempDir,
}
impl Sandbox {
    fn new() -> Self {
        let root = tempfile::Builder::new()
            .prefix("lnxt theme ' ")
            .tempdir()
            .unwrap();
        let bin = root.path().join("bin");
        fs::create_dir(&bin).unwrap();
        fs::write(root.path().join("preference"), "'default'\n").unwrap();
        let fake = bin.join("gsettings");
        fs::write(
            &fake,
            r#"#!/bin/sh
case "$1" in
  get) /bin/cat "$FAKE_PREFERENCE" ;;
  set)
    printf "'%s'\n" "$4" > "$FAKE_PREFERENCE"
    if test "$FAKE_FAIL_LIGHT" = yes && test "$4" = prefer-light; then
      if test -n "$FAKE_EXTERNAL_CONFIG"; then
        /bin/cp "$FAKE_EXTERNAL_CONFIG" "$FAKE_CONFIG"
      fi
      printf 'failed preference update\n' >&2
      exit 1
    fi ;;
  *) exit 7 ;;
esac
"#,
        )
        .unwrap();
        fs::set_permissions(fake, fs::Permissions::from_mode(0o755)).unwrap();
        Self { root }
    }
    fn command(&self) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_lnxt"));
        command
            .env_clear()
            .env("HOME", self.root.path().join("home"))
            .env("XDG_CONFIG_HOME", self.root.path().join("config"))
            .env("XDG_DATA_HOME", self.root.path().join("data"))
            .env(
                "PATH",
                format!("{}:/usr/bin:/bin", self.root.path().join("bin").display()),
            )
            .env("FAKE_PREFERENCE", self.root.path().join("preference"))
            .env("FAKE_CONFIG", self.config())
            .current_dir(self.root.path());
        command
    }
    fn config(&self) -> PathBuf {
        self.root.path().join("config/luna-next/theme.conf")
    }
    fn source(&self, name: &str, content: &str) -> PathBuf {
        let path = self.root.path().join(name);
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("theme.conf"), content).unwrap();
        path
    }
    fn success(&self, args: &[&str]) -> Value {
        success(self.command().args(args).arg("--json").output().unwrap())
    }
}
fn success(output: Output) -> Value {
    assert!(output.status.success(), "{output:?}");
    assert!(output.stderr.is_empty(), "{output:?}");
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["ok"], true, "{value}");
    value["result"].clone()
}
fn error(output: Output) -> String {
    assert!(!output.status.success(), "{output:?}");
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["ok"], false);
    value["error"].as_str().unwrap().into()
}

#[test]
fn theme_commands_install_select_resolve_toggle_and_export_native_appearance() {
    let s = Sandbox::new();
    let bundle = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../themes/bundled/tokyo-night");
    assert_eq!(s.success(&["theme", "current"]), Value::Null);
    assert_eq!(s.success(&["theme", "get", "colors.background"]), "#1a1b26");
    assert_eq!(s.success(&["theme", "get", "missing"]), Value::Null);
    assert_eq!(s.success(&["theme", "get-config-file"]), json!(s.config()));
    let installed = s.success(&["theme", "install", bundle.to_str().unwrap()]);
    assert_eq!(s.success(&["theme", "path", "tokyo-night"]), installed);
    assert_eq!(
        s.success(&["theme", "inspect", "tokyo-night"])["appearance"]["gaps"]["inner"],
        5
    );
    let value = s.success(&["theme", "set", "tokyo-night"]);
    assert_eq!(value["colors"]["mode"], "dark");
    assert_eq!(value.get("hyprland"), None);
    assert_eq!(s.success(&["theme", "current"]), "tokyo-night");
    assert_eq!(
        s.success(&["theme", "list"]),
        json!([{"name":"tokyo-night", "current":true}])
    );
    let source = fs::read_to_string(s.config()).unwrap();
    assert!(source.contains("\"theme\" {\n"), "{source}");
    assert!(!source.contains("\"theme\".\""), "{source}");
    assert!(
        !source.contains("#1a1b26"),
        "resolved palette must stay out of selection source"
    );
    assert_eq!(s.success(&["theme", "mode"]), "dark");
    assert_eq!(s.success(&["theme", "toggle"]), "light");
    assert_eq!(s.success(&["theme", "get", "colors.mode"]), "dark");
    assert_eq!(s.success(&["theme", "mode", "toggle"]), "dark");
    assert_eq!(s.success(&["theme", "mode", "light"]), "light");
    assert_eq!(
        s.success(&["theme", "set", "tokyo-night"])["name"],
        "tokyo-night"
    );
    assert_eq!(s.success(&["theme", "mode"]), "dark");
    let human = s.command().args(["theme", "list"]).output().unwrap();
    assert_eq!(String::from_utf8(human.stdout).unwrap(), "* tokyo-night\n");
    let native = s.success(&["theme", "hyprland"]);
    assert_eq!(native["general"]["border_size"], 1);
    assert_eq!(native["decoration"]["shadow"]["render_power"], 3);
    let lua = s.command().args(["theme", "hyprland"]).output().unwrap();
    assert!(lua.status.success());
    let evaluated = Command::new("lua").args(["-E", "-e", &format!("local theme = (function() {} end)(); assert(theme.general.col.active_border == '#7aa2f7'); assert(theme.decoration.active_opacity == 0.9)", String::from_utf8(lua.stdout).unwrap())]).output().unwrap();
    assert!(evaluated.status.success(), "{evaluated:?}");
}

#[test]
fn selection_preserves_includes_comments_permissions_and_symlinks() {
    let s = Sandbox::new();
    let source = s.source("custom", "appearance { rounding = 11 }\n");
    s.success(&["theme", "install", source.to_str().unwrap()]);
    let canonical = s.root.path().join("selection.conf");
    let defaults = s.root.path().join("defaults.conf");
    fs::write(&defaults, "theme { mode = light }\n").unwrap();
    let original = "# selection comment\ninclude required(file(\"defaults.conf\"))\n";
    fs::write(&canonical, original).unwrap();
    fs::set_permissions(&canonical, fs::Permissions::from_mode(0o640)).unwrap();
    symlink(&canonical, s.config()).unwrap();
    assert_eq!(
        s.success(&["theme", "set", "custom"])["appearance"]["rounding"],
        11
    );
    let saved = fs::read_to_string(&canonical).unwrap();
    assert!(saved.starts_with(original));
    assert_eq!(
        fs::metadata(&canonical).unwrap().permissions().mode() & 0o777,
        0o640
    );
    assert!(fs::symlink_metadata(s.config()).unwrap().is_symlink());
    assert_eq!(
        fs::read_to_string(&defaults).unwrap(),
        "theme { mode = light }\n"
    );
    fs::write(source.join("theme.conf"), "appearance { rounding = 99 }\n").unwrap();
    assert_eq!(s.success(&["theme", "get", "appearance.rounding"]), 11);
    let installed = s.success(&["theme", "path", "custom"]);
    fs::write(
        Path::new(installed.as_str().unwrap()).join("theme.conf"),
        "appearance { rounding = 15 }\n",
    )
    .unwrap();
    assert_eq!(s.success(&["theme", "get", "appearance.rounding"]), 15);
}

#[test]
fn failed_application_restores_exact_source_and_previous_desktop_preference() {
    let s = Sandbox::new();
    let source = s.source("light", "colors { mode = light }\n");
    s.success(&["theme", "install", source.to_str().unwrap()]);
    fs::write(s.root.path().join("preference"), "'prefer-dark'\n").unwrap();
    let before = "# keep exact bytes\ntheme { mode = dark }\n";
    fs::write(s.config(), before).unwrap();
    let output = s
        .command()
        .env("FAKE_FAIL_LIGHT", "yes")
        .args(["theme", "set", "light", "--json"])
        .output()
        .unwrap();
    assert!(error(output).contains("failed preference update"));
    assert_eq!(fs::read_to_string(s.config()).unwrap(), before);
    assert_eq!(
        fs::read_to_string(s.root.path().join("preference")).unwrap(),
        "'prefer-dark'\n"
    );
    assert_eq!(s.success(&["theme", "current"]), Value::Null);
}

#[test]
fn failed_application_preserves_external_selection_edits() {
    let s = Sandbox::new();
    s.success(&["theme", "get"]);
    let external = s.root.path().join("external.conf");
    let text = "# external editor\ntheme { mode = light }\n";
    fs::write(&external, text).unwrap();
    fs::write(s.root.path().join("preference"), "'prefer-dark'\n").unwrap();
    let output = s
        .command()
        .env("FAKE_FAIL_LIGHT", "yes")
        .env("FAKE_EXTERNAL_CONFIG", &external)
        .args(["theme", "mode", "light", "--json"])
        .output()
        .unwrap();
    assert!(error(output).contains("changed externally"));
    assert_eq!(fs::read_to_string(s.config()).unwrap(), text);
}

#[test]
fn removal_requires_confirmation_and_protects_selected_themes() {
    let s = Sandbox::new();
    for name in ["one", "two"] {
        let source = s.source(name, "{}\n");
        s.success(&["theme", "install", source.to_str().unwrap()]);
    }
    s.success(&["theme", "set", "one"]);
    assert!(
        error(
            s.command()
                .args(["theme", "remove", "one", "--yes", "--json"])
                .output()
                .unwrap()
        )
        .contains("current")
    );
    assert!(
        error(
            s.command()
                .args(["theme", "remove", "two", "--json"])
                .output()
                .unwrap()
        )
        .contains("--yes")
    );
    let preview = s.success(&["theme", "remove", "two", "--dry-run"]);
    assert_eq!(s.success(&["theme", "remove", "two", "--yes"]), preview);
    assert!(s.root.path().join("two/theme.conf").exists());
    assert_eq!(
        s.success(&["theme", "list"]),
        json!([{"name":"one", "current":true}])
    );
}

#[test]
fn xdg_defaults_and_invalid_arguments_are_handled_consistently() {
    let s = Sandbox::new();
    let output = s
        .command()
        .env_remove("XDG_CONFIG_HOME")
        .env("XDG_DATA_HOME", "")
        .args(["theme", "path", "--json"])
        .output()
        .unwrap();
    assert_eq!(
        success(output),
        json!(s.root.path().join("home/.local/share/luna-next/themes"))
    );
    let output = s
        .command()
        .env("XDG_CONFIG_HOME", "")
        .args(["theme", "get-config-file", "--json"])
        .output()
        .unwrap();
    assert_eq!(
        success(output),
        json!(s.root.path().join("home/.config/luna-next/theme.conf"))
    );
    let output = s
        .command()
        .args(["theme", "mode", "invalid", "--json"])
        .output()
        .unwrap();
    assert!(error(output).contains("invalid"));
    assert_eq!(s.success(&["theme", "list"]), json!([]));
}
