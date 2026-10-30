use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
};

use serde_json::{Value, json};
use tempfile::TempDir;

struct Sandbox {
    root: TempDir,
}

impl Sandbox {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("bin")).unwrap();
        Self { root }
    }

    fn config(&self) -> PathBuf {
        self.root.path().join("config/luna-next/login.conf")
    }

    fn command(&self) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_luna"));
        command
            .env_clear()
            .env("HOME", self.root.path())
            .env("XDG_CONFIG_HOME", self.root.path().join("config"))
            .env("XDG_DATA_HOME", self.root.path().join("data"))
            .env("PATH", self.root.path().join("bin"))
            .env("LOGIN_TEST_ROOT", self.root.path())
            .stdin(Stdio::null())
            .current_dir(self.root.path());
        command
    }

    fn run(&self, args: &[&str]) -> Output {
        self.command().arg("login").args(args).output().unwrap()
    }

    fn success(&self, args: &[&str]) -> Value {
        let output = self.run(args);
        assert!(output.status.success(), "{output:?}");
        let response: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(response["ok"], true, "{response}");
        response["result"].clone()
    }

    fn tool(&self, name: &str, code: &str) {
        let path = self.root.path().join("bin").join(name);
        fs::write(&path, code).unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    }
}

#[test]
fn screen_install_selection_and_build_use_an_isolated_snapshot() {
    let sandbox = Sandbox::new();
    assert_eq!(sandbox.success(&["current", "--json"]), "default");
    assert_eq!(
        sandbox.success(&["get-config", "missing", "--json"]),
        Value::Null
    );
    let source = sandbox.root.path().join("custom screen");
    fs::create_dir(&source).unwrap();
    fs::write(
        source.join("Screen.qml"),
        "import QtQuick\nItem { required property var settings; required property var login }\n",
    )
    .unwrap();
    let output = sandbox
        .command()
        .args(["login", "install", "--name", "custom", "--json"])
        .arg(&source)
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    let selected = sandbox.success(&["set", "custom", "--json"]);
    assert_eq!(selected["screen"]["name"], "custom");
    let listed = sandbox.success(&["list", "--json"]);
    assert!(
        listed
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| { entry["name"] == "custom" && entry["current"] == true })
    );
    let destination = sandbox.root.path().join("built theme");
    let output = sandbox
        .command()
        .args(["login", "build", "--json"])
        .arg(&destination)
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    for name in [
        "Main.qml",
        "metadata.desktop",
        "Settings.js",
        "screen/Screen.qml",
    ] {
        assert!(destination.join(name).is_file(), "missing {name}");
    }
    fs::remove_dir_all(source).unwrap();
    let settings = fs::read_to_string(destination.join("Settings.js")).unwrap();
    assert!(settings.contains("\"screen\""));
    assert!(settings.contains("\"custom\""));
    assert!(settings.contains("\"accent\""));
    assert!(!settings.contains(sandbox.root.path().to_str().unwrap()));
}

#[test]
fn config_edits_preserve_includes_and_invalid_changes_leave_source_untouched() {
    let sandbox = Sandbox::new();
    let config = sandbox.config();
    fs::create_dir_all(config.parent().unwrap()).unwrap();
    fs::write(
        config.with_file_name("login-defaults.conf"),
        "wallpaper.fit = fit\n",
    )
    .unwrap();
    fs::write(
        &config,
        "# local preferences\ninclude \"login-defaults.conf\"\n",
    )
    .unwrap();
    let result = sandbox.success(&[
        "update-config",
        "{\"colors\":{\"accent\":\"#123456\"},\"wallpaper\":{\"type\":\"video\"}}",
        "--json",
    ]);
    assert_eq!(result["wallpaper"]["fit"], "fit");
    assert_eq!(result["colors"]["accent"], "#123456");
    let saved = fs::read_to_string(&config).unwrap();
    assert!(saved.contains("# local preferences"));
    assert!(saved.contains("include \"login-defaults.conf\""));
    for changes in [
        "{\"colors\":{\"accent\":\"bad-color\"}}",
        "{\"wallpaper\":{\"type\":\"bad-type\"}}",
        "{\"wallpaper\":{\"source\":\"relative.mp4\"}}",
    ] {
        let output = sandbox.run(&["update-config", changes, "--json"]);
        assert!(!output.status.success(), "{output:?}");
        let response: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(response["ok"], false);
        assert_eq!(fs::read_to_string(&config).unwrap(), saved);
    }
}

#[test]
fn activation_elevates_only_a_prepared_bundle_and_keeps_tool_output_out_of_json() {
    let sandbox = Sandbox::new();
    sandbox.tool(
        "sudo",
        r#"#!/usr/bin/python3
import json, os, pathlib, shutil, sys
root = pathlib.Path(os.environ['LOGIN_TEST_ROOT'])
args = sys.argv[1:]
assert args[0] == '--' and args[2:4] == ['login', 'deploy'], args
bundle = pathlib.Path(args[4])
assert (bundle / 'Main.qml').is_file()
assert (bundle / 'Settings.js').is_file()
shutil.copytree(bundle, root / 'captured', dirs_exist_ok=True)
(root / 'installer.json').write_text(json.dumps({'bundle': str(bundle), 'args': args}))
print('installer progress')
sys.exit(int(os.environ.get('LOGIN_TEST_FAIL', '0')))
"#,
    );
    let output = sandbox.run(&["activate", "--json"]);
    assert!(output.status.success(), "{output:?}");
    let response: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(
        response,
        json!({
            "ok": true, "result": "/usr/local/share/luna-next/login/active"
        })
    );
    assert!(String::from_utf8_lossy(&output.stderr).contains("installer progress"));
    let log: Value = serde_json::from_str(
        &fs::read_to_string(sandbox.root.path().join("installer.json")).unwrap(),
    )
    .unwrap();
    assert!(!Path::new(log["bundle"].as_str().unwrap()).exists());
    let original = fs::read_to_string(sandbox.config()).unwrap();
    let output = sandbox
        .command()
        .env("LOGIN_TEST_FAIL", "17")
        .args(["login", "activate", "--json"])
        .output()
        .unwrap();
    assert!(!output.status.success(), "{output:?}");
    let response: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["ok"], false);
    assert!(
        response["error"]
            .as_str()
            .unwrap()
            .contains("activation failed")
    );
    assert_eq!(fs::read_to_string(sandbox.config()).unwrap(), original);
}

#[test]
fn preview_uses_sddm_test_mode_and_help_exposes_only_user_commands() {
    let sandbox = Sandbox::new();
    sandbox.tool(
        "sddm-greeter-qt6",
        r#"#!/usr/bin/python3
import os, pathlib, sys
assert sys.argv[1:3] == ['--test-mode', '--theme'], sys.argv
assert pathlib.Path(sys.argv[3], 'screen/Screen.qml').is_file()
pathlib.Path(os.environ['LOGIN_TEST_ROOT'], 'previewed').touch()
"#,
    );
    let output = sandbox.run(&["preview", "--json"]);
    assert_eq!(output.status.code(), Some(1));
    assert!(!sandbox.root.path().join("previewed").exists());
    assert!(!sandbox.config().exists());
    let output = sandbox.run(&["preview"]);
    assert!(output.status.success(), "{output:?}");
    assert!(sandbox.root.path().join("previewed").exists());
    let output = sandbox.run(&["--help"]);
    assert!(output.status.success());
    let help = String::from_utf8(output.stdout).unwrap();
    for command in [
        "install",
        "list",
        "current",
        "set",
        "build",
        "preview",
        "activate",
        "get-config",
    ] {
        assert!(help.contains(command), "{help}");
    }
    assert!(
        !help
            .lines()
            .any(|line| line.trim_start().starts_with("deploy "))
    );
}
