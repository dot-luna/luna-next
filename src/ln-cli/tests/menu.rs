use std::{fs, os::unix::fs::PermissionsExt, path::Path, process::Command};

use serde_json::{Value, json};

const COMMAND: &str = r#"#!/usr/bin/python3
import json, os, pathlib, sys
file = pathlib.Path(os.environ['LUNA_MENU_TEST']) / 'state.json'
state = json.loads(file.read_text())
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
state['calls'].append([name, *args])
def save(): file.write_text(json.dumps(state))
save()
if name == 'systemctl':
    action = args[1]
    if action == 'is-active': sys.exit(0 if state['active'] else 3)
    if action in ('start', 'restart'): state.update(active=True, visible=False)
    if action == 'stop': state.update(active=False, visible=False)
    print('service progress')
elif args[0] == 'ipc':
    assert args[3:6] == ['call', '--', 'menu']
    if not state['active']: sys.exit(1)
    method = args[6]
    if method == 'status': print('running')
    elif method == 'show': state['visible'] = True
    elif method == 'hide': state['visible'] = False
    elif method == 'toggle': state['visible'] = not state['visible']
    else: raise AssertionError(method)
else:
    assert os.environ['LUNA_NEXT_MENU_VALIDATE'] == '1'
    assert set(json.loads(os.environ['LUNA_NEXT_MENU_THEME'])) == {'colors', 'fonts', 'appearance'}
    print('qml: Luna Next menu validation passed')
save()
"#;

fn fixture() -> tempfile::TempDir {
    let root = tempfile::tempdir().unwrap();
    let path = root.path();
    fs::create_dir(path.join("bin")).unwrap();
    fs::create_dir_all(path.join("data/luna-next/menu/shell")).unwrap();
    fs::write(
        path.join("data/luna-next/menu/shell/shell.qml"),
        "ShellRoot {}",
    )
    .unwrap();
    fs::create_dir_all(path.join("config/systemd/user")).unwrap();
    fs::write(
        path.join("config/systemd/user/luna-next-menu.service"),
        "[Service]\n",
    )
    .unwrap();
    fs::write(
        path.join("state.json"),
        r#"{"calls":[],"active":false,"visible":false}"#,
    )
    .unwrap();
    for name in ["qs", "systemctl"] {
        let command = path.join("bin").join(name);
        fs::write(&command, COMMAND).unwrap();
        fs::set_permissions(command, fs::Permissions::from_mode(0o755)).unwrap();
    }
    root
}

fn state(root: &Path) -> Value {
    serde_json::from_slice(&fs::read(root.join("state.json")).unwrap()).unwrap()
}

fn run(root: &Path, arguments: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_luna"))
        .args(arguments)
        .env_clear()
        .env("HOME", root.join("home"))
        .env("XDG_CONFIG_HOME", root.join("config"))
        .env("XDG_DATA_HOME", root.join("data"))
        .env("PATH", root.join("bin"))
        .env("WAYLAND_DISPLAY", "menu-test-display")
        .env("LUNA_MENU_TEST", root)
        .current_dir(root)
        .output()
        .unwrap()
}

fn json_result(root: &Path, arguments: &[&str], expected: &str) {
    let output = run(root, arguments);
    assert!(output.status.success(), "{output:?}");
    assert!(output.stderr.is_empty(), "{output:?}");
    assert_eq!(
        serde_json::from_slice::<Value>(&output.stdout).unwrap(),
        json!({"ok": true, "result": expected})
    );
}

#[test]
fn menu_without_subcommand_shows_launcher_and_keeps_command_progress_out_of_json() {
    let root = fixture();
    json_result(root.path(), &["menu", "--json"], "running");
    assert_eq!(state(root.path())["visible"], true);
    json_result(root.path(), &["--json", "menu", "show"], "running");
    let state = state(root.path());
    assert_eq!(state["visible"], true);
    assert_eq!(
        state["calls"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|call| call[0] == "systemctl" && call[2] == "start")
            .count(),
        1
    );
    assert_eq!(
        state["calls"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|call| call[0] == "qs" && call[7] == "show")
            .count(),
        2
    );
}

#[test]
fn start_and_restart_leave_launcher_hidden_while_visibility_commands_keep_service_running() {
    let root = fixture();
    json_result(root.path(), &["menu", "start", "--json"], "running");
    assert_eq!(state(root.path())["visible"], false);
    json_result(root.path(), &["menu", "toggle", "--json"], "running");
    assert_eq!(state(root.path())["visible"], true);
    json_result(root.path(), &["menu", "hide", "--json"], "running");
    assert_eq!(state(root.path())["visible"], false);
    json_result(root.path(), &["menu", "show", "--json"], "running");
    json_result(root.path(), &["menu", "restart", "--json"], "running");
    assert_eq!(state(root.path())["visible"], false);
    json_result(root.path(), &["menu", "status", "--json"], "running");
}

#[test]
fn toggle_starts_a_stopped_menu_and_shows_it() {
    let root = fixture();
    json_result(root.path(), &["menu", "toggle", "--json"], "running");
    assert_eq!(state(root.path())["visible"], true);
    assert_eq!(state(root.path())["active"], true);
}

#[test]
fn hide_and_status_leave_a_stopped_service_stopped() {
    let root = fixture();
    json_result(root.path(), &["menu", "hide", "--json"], "stopped");
    let output = run(root.path(), &["menu", "status"]);
    assert!(output.status.success(), "{output:?}");
    assert_eq!(output.stdout, b"stopped\n");
    assert!(
        state(root.path())["calls"]
            .as_array()
            .unwrap()
            .iter()
            .all(|call| call[0] == "qs")
    );
}

#[test]
fn stop_does_not_disable_login_startup() {
    let root = fixture();
    json_result(root.path(), &["menu", "stop", "--json"], "stopped");
    assert_eq!(
        state(root.path())["calls"],
        json!([["systemctl", "--user", "stop", "luna-next-menu.service"]])
    );
}

#[test]
fn foreground_json_is_rejected_before_any_external_command() {
    let root = fixture();
    let output = run(root.path(), &["menu", "serve", "--json"]);
    assert!(!output.status.success());
    let response: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["ok"], false);
    assert!(response["error"].as_str().unwrap().contains("foreground"));
    assert_eq!(state(root.path())["calls"], json!([]));
}

#[test]
fn missing_service_reports_a_json_error_without_launching_menu() {
    let root = fixture();
    fs::remove_file(
        root.path()
            .join("config/systemd/user/luna-next-menu.service"),
    )
    .unwrap();
    let output = run(root.path(), &["menu", "--json"]);
    assert!(!output.status.success());
    let response: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["ok"], false);
    assert!(
        response["error"]
            .as_str()
            .unwrap()
            .contains("luna configure luna-menu")
    );
    assert_eq!(state(root.path())["calls"], json!([]));
}
