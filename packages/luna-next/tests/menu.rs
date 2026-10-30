//! Fake commands run in subprocesses without addressing the user's desktop or services.

use std::{
    fs,
    os::unix::fs::{PermissionsExt, symlink},
    path::Path,
    process::Command,
    time::{Duration, Instant},
};

use luna_next::menu::{Menu, Paths, Status, UNIT};
use serde_json::{Value, json};

const COMMAND: &str = r#"#!/usr/bin/python3
import json, os, pathlib, sys, time
root = pathlib.Path(os.environ['LUNA_MENU_TEST'])
file = root / 'state.json'
state = json.loads(file.read_text())
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
state['calls'].append([name, *args])
def save(): file.write_text(json.dumps(state))
save()
if name == 'systemctl':
    action = args[1]
    if action == 'import-environment':
        state.setdefault('manager', {}).update({key: os.environ[key] for key in args[2:]})
    if action == 'unset-environment':
        for key in args[2:]: state.setdefault('manager', {}).pop(key, None)
    if action == 'is-active':
        if state.get('bus_error'):
            print('Cannot connect to bus', file=sys.stderr)
            sys.exit(1)
        sys.exit(0 if state.get('active') else 3)
    if action in ('start', 'restart'):
        state['active'] = not state.get('exit_early', False)
        state['visible'] = False
        state['launched'] = True
        state['pending'] = state.get('readiness_pending', 0)
    if action == 'stop': state['active'] = state['visible'] = False
    if action == 'enable': state['enabled'] = True
    save()
    if action in ('start', 'restart') and state.get('start_failure'):
        print('Failed to start service', file=sys.stderr)
        sys.exit(1)
elif args[0] == 'ipc':
    assert args[3:6] == ['call', '--', 'menu']
    method = args[6]
    if state.get('launched') and state.get('hang_ipc'): time.sleep(20)
    if not state.get('active'): sys.exit(1)
    if method == 'status':
        if state.get('pending', 0):
            state['pending'] -= 1
            save()
            sys.exit(1)
        print(state.get('status_reply', 'running'))
    else:
        if state.get('ipc_failure'):
            print('IPC rejected', file=sys.stderr)
            sys.exit(1)
        if method == 'show': state['visible'] = True
        elif method == 'hide': state['visible'] = False
        elif method == 'toggle': state['visible'] = not state['visible']
        else: raise AssertionError(method)
        save()
else:
    state['theme'] = json.loads(os.environ['LUNA_NEXT_MENU_THEME'])
    state['validating'] = os.environ.get('LUNA_NEXT_MENU_VALIDATE')
    state['shell'] = args[1]
    save()
    if state['validating'] == '1':
        if state.get('hang_validation'): time.sleep(20)
        if not state.get('missing_marker'):
            print('qml: Luna Next menu validation passed', file=sys.stderr)
        sys.exit(1 if state.get('invalid_qml') else 0)
"#;

fn read_state(root: &Path) -> Value {
    serde_json::from_slice(&fs::read(root.join("state.json")).unwrap()).unwrap()
}

fn write_state(root: &Path, state: &Value) {
    fs::write(root.join("state.json"), serde_json::to_vec(state).unwrap()).unwrap();
}

fn scenario(name: &str) {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path();
    fs::create_dir(root.join("bin")).unwrap();
    fs::create_dir_all(root.join("config/systemd/user")).unwrap();
    fs::create_dir_all(root.join("data/luna-next/menu/shell")).unwrap();
    fs::write(
        root.join("data/luna-next/menu/shell/shell.qml"),
        "ShellRoot {}",
    )
    .unwrap();
    fs::write(root.join("config/systemd/user").join(UNIT), "[Service]\n").unwrap();
    fs::write(root.join("bin/command"), COMMAND).unwrap();
    fs::set_permissions(root.join("bin/command"), fs::Permissions::from_mode(0o755)).unwrap();
    symlink("command", root.join("bin/qs")).unwrap();
    symlink("command", root.join("bin/systemctl")).unwrap();
    write_state(
        root,
        &json!({"calls": [], "active": false, "visible": false}),
    );
    let output = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "menu_scenario", "--nocapture"])
        .env_clear()
        .env("LUNA_MENU_TEST", root)
        .env("LUNA_MENU_SCENARIO", name)
        .env("HOME", root.join("home"))
        .env("XDG_CONFIG_HOME", root.join("config"))
        .env("XDG_DATA_HOME", root.join("data"))
        .env("XDG_STATE_HOME", root.join("state"))
        .env("XDG_CACHE_HOME", root.join("cache"))
        .env("PATH", root.join("bin"))
        .env("WAYLAND_DISPLAY", "menu-test-display")
        .env("QML_IMPORT_PATH", "/test/qml-imports")
        .env(
            "LUNA_NEXT_MENU_VALIDATE",
            "inherited-validation-must-be-cleared",
        )
        .current_dir(root)
        .output()
        .unwrap();
    assert!(output.status.success(), "{name}: {output:?}");
    if name == "serve" {
        let state = read_state(root);
        assert!(state["validating"].is_null());
        assert_eq!(state["theme"]["fonts"]["ui"], "Outfit");
        assert_eq!(state["theme"].as_object().unwrap().len(), 3);
        assert_eq!(state["calls"].as_array().unwrap().len(), 1);
    }
}

#[test]
fn start_validates_imports_environment_and_waits_for_hidden_menu() {
    scenario("start");
}

#[test]
fn healthy_start_preserves_visibility_and_skips_new_theme_validation() {
    scenario("healthy");
}

#[test]
fn show_hide_and_toggle_control_visibility_without_restarting() {
    scenario("visibility");
}

#[test]
fn hide_does_not_start_a_stopped_service() {
    scenario("hide_stopped");
}

#[test]
fn invalid_qml_missing_marker_and_invalid_theme_keep_existing_menu() {
    scenario("invalid_qml");
    scenario("missing_marker");
    scenario("invalid_theme");
}

#[test]
fn restart_validates_before_replacing_the_menu_and_starts_hidden() {
    scenario("restart");
}

#[test]
fn stop_preserves_login_startup_and_bypasses_theme_and_session_validation() {
    scenario("stop");
}

#[test]
fn status_reports_ipc_readiness_independent_of_visibility() {
    scenario("status");
}

#[test]
fn failed_start_and_early_exit_stop_the_unsuccessful_service() {
    scenario("start_failure");
    scenario("exit_early");
    scenario("bus_error");
}

#[test]
fn missing_installation_or_session_never_changes_services() {
    scenario("missing_unit");
    scenario("missing_shell");
    scenario("missing_session");
}

#[test]
fn foreground_mode_passes_theme_once_and_removes_validation_before_exec() {
    scenario("serve");
}

#[test]
fn stalled_validation_is_bounded_without_service_changes() {
    scenario("hang_validation");
}

#[test]
fn stalled_ipc_is_bounded_and_stops_the_new_service() {
    scenario("hang_ipc");
}

#[test]
fn shell_override_import_is_absolute_and_cleared_when_leaving_override() {
    scenario("override_env");
}

#[test]
fn default_homes_clear_stale_manager_paths_without_removing_session_identity() {
    scenario("paths_env");
}

#[test]
fn environment_paths_support_xdg_fallbacks_and_nonempty_shell_override() {
    scenario("paths");
}

#[test]
fn explicit_paths_reject_empty_values() {
    for (shell_path, service_file) in [("", "unit"), ("shell", "")] {
        assert!(
            Menu::new(Paths {
                shell_path: shell_path.into(),
                service_file: service_file.into(),
            })
            .is_err()
        );
    }
}

#[test]
fn menu_scenario() {
    let Ok(name) = std::env::var("LUNA_MENU_SCENARIO") else {
        return;
    };
    let root = std::env::var_os("LUNA_MENU_TEST").unwrap();
    let root = Path::new(&root);
    let menu = Menu::from_env().unwrap();
    assert_eq!(
        menu.paths().shell_path,
        root.join("data/luna-next/menu/shell/shell.qml")
    );
    assert_eq!(
        menu.paths().service_file,
        root.join("config/systemd/user").join(UNIT)
    );
    let mut state = read_state(root);
    match name.as_str() {
        "start" => {
            state["readiness_pending"] = json!(2);
            write_state(root, &state);
            assert_eq!(menu.start().unwrap(), Status::Running);
            let state = read_state(root);
            assert_eq!(state["visible"], false);
            assert_eq!(state["theme"]["fonts"]["ui"], "Outfit");
            assert_eq!(state["theme"].as_object().unwrap().len(), 3);
            assert!(state["theme"].get("wallpaper").is_none());
            assert_eq!(state["enabled"], true);
            let calls = state["calls"].as_array().unwrap();
            let validation = calls.iter().position(|call| call[1] == "-p").unwrap();
            let first_change = calls
                .iter()
                .position(|call| call[0] == "systemctl")
                .unwrap();
            assert!(validation < first_change);
            assert!(calls.iter().filter(|call| call[1] == "ipc").count() >= 4);
            let import = calls
                .iter()
                .find(|call| call[2] == "import-environment")
                .unwrap();
            for variable in [
                "WAYLAND_DISPLAY",
                "XDG_CONFIG_HOME",
                "XDG_DATA_HOME",
                "QML_IMPORT_PATH",
            ] {
                assert!(import.as_array().unwrap().contains(&json!(variable)));
            }
        }
        "healthy" | "invalid_qml" | "missing_marker" | "invalid_theme" => {
            state["active"] = json!(true);
            state["visible"] = json!(true);
            if name == "invalid_theme" || name == "healthy" {
                fs::create_dir_all(root.join("config/luna-next")).unwrap();
                fs::write(root.join("config/luna-next/theme.conf"), "broken = [").unwrap();
            } else {
                state[&name] = json!(true);
            }
            write_state(root, &state);
            if name == "healthy" {
                assert_eq!(menu.start().unwrap(), Status::Running);
            } else {
                assert!(menu.restart().is_err());
            }
            let state = read_state(root);
            assert_eq!(state["active"], true);
            assert_eq!(state["visible"], true);
            let changes: Vec<_> = state["calls"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|call| call[0] == "systemctl")
                .cloned()
                .collect();
            assert_eq!(
                changes,
                if name == "healthy" {
                    vec![json!(["systemctl", "--user", "enable", UNIT])]
                } else {
                    vec![]
                }
            );
        }
        "visibility" => {
            assert_eq!(menu.show().unwrap(), Status::Running);
            assert_eq!(read_state(root)["visible"], true);
            assert_eq!(menu.show().unwrap(), Status::Running);
            assert_eq!(read_state(root)["visible"], true);
            assert_eq!(menu.toggle().unwrap(), Status::Running);
            assert_eq!(read_state(root)["visible"], false);
            assert_eq!(menu.toggle().unwrap(), Status::Running);
            assert_eq!(read_state(root)["visible"], true);
            assert_eq!(menu.hide().unwrap(), Status::Running);
            assert_eq!(read_state(root)["visible"], false);
            let state = read_state(root);
            assert_eq!(
                state["calls"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|call| call[0] == "systemctl" && call[2] == "start")
                    .count(),
                1
            );
            let mut state = state;
            state["ipc_failure"] = json!(true);
            write_state(root, &state);
            assert!(
                menu.show()
                    .unwrap_err()
                    .to_string()
                    .contains("IPC rejected")
            );
            assert_eq!(read_state(root)["active"], true);
        }
        "hide_stopped" => {
            assert_eq!(menu.hide().unwrap(), Status::Stopped);
            assert!(
                read_state(root)["calls"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|call| call[0] == "qs"
                        && call[5] == "--"
                        && call[6] == "menu"
                        && call[7] == "status")
            );
        }
        "restart" => {
            state["active"] = json!(true);
            state["visible"] = json!(true);
            write_state(root, &state);
            assert_eq!(menu.restart().unwrap(), Status::Running);
            let state = read_state(root);
            assert_eq!(state["calls"][0][1], "-p");
            assert_eq!(state["visible"], false);
            assert!(
                state["calls"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|call| call[2] == "restart")
            );
        }
        "stop" => {
            state["enabled"] = json!(true);
            write_state(root, &state);
            unsafe {
                std::env::remove_var("WAYLAND_DISPLAY");
            }
            assert_eq!(menu.stop().unwrap(), Status::Stopped);
            assert_eq!(
                read_state(root)["calls"],
                json!([["systemctl", "--user", "stop", UNIT]])
            );
            assert_eq!(read_state(root)["enabled"], true);
        }
        "status" => {
            assert_eq!(menu.status().unwrap(), Status::Stopped);
            state["active"] = json!(true);
            write_state(root, &state);
            assert_eq!(menu.status().unwrap(), Status::Running);
            state["visible"] = json!(true);
            write_state(root, &state);
            assert_eq!(menu.status().unwrap(), Status::Running);
            state["status_reply"] = json!("unexpected");
            write_state(root, &state);
            assert!(
                menu.status()
                    .unwrap_err()
                    .to_string()
                    .contains("Invalid Luna Next menu status")
            );
        }
        "start_failure" | "exit_early" | "bus_error" | "hang_validation" | "hang_ipc" => {
            state[&name] = json!(true);
            if name == "bus_error" {
                state["readiness_pending"] = json!(2);
            }
            write_state(root, &state);
            let started = Instant::now();
            let error = menu.start().unwrap_err().to_string();
            if name.starts_with("hang_") {
                assert!(error.contains("timed out"), "{error}");
                assert!(started.elapsed() < Duration::from_secs(14));
            } else {
                let expected = match name.as_str() {
                    "start_failure" => "Failed to start service",
                    "exit_early" => "exited before becoming ready",
                    _ => "Cannot connect to bus",
                };
                assert!(error.contains(expected), "{error}");
            }
            let state = read_state(root);
            let changes: Vec<_> = state["calls"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|call| call[0] == "systemctl")
                .collect();
            if name == "hang_validation" {
                assert!(changes.is_empty());
            } else {
                assert_eq!(changes.last().unwrap()[2], "stop");
                assert_eq!(state["active"], false);
            }
        }
        "missing_unit" | "missing_shell" | "missing_session" => {
            match name.as_str() {
                "missing_unit" => fs::remove_file(&menu.paths().service_file).unwrap(),
                "missing_shell" => fs::remove_file(&menu.paths().shell_path).unwrap(),
                _ => unsafe {
                    std::env::remove_var("WAYLAND_DISPLAY");
                },
            }
            assert!(menu.start().is_err());
            assert!(
                read_state(root)["calls"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|call| call[0] != "systemctl")
            );
        }
        "serve" => menu.serve().unwrap(),
        "override_env" => {
            symlink(&menu.paths().shell_path, root.join("custom-shell.qml")).unwrap();
            unsafe {
                std::env::set_var("LUNA_NEXT_MENU_SHELL", "custom-shell.qml");
            }
            Menu::from_env().unwrap().start().unwrap();
            assert_eq!(
                read_state(root)["manager"]["LUNA_NEXT_MENU_SHELL"],
                menu.paths().shell_path.to_str().unwrap()
            );
            for value in [None, Some("")] {
                unsafe {
                    match value {
                        None => std::env::remove_var("LUNA_NEXT_MENU_SHELL"),
                        Some(value) => std::env::set_var("LUNA_NEXT_MENU_SHELL", value),
                    }
                }
                let mut state = read_state(root);
                state["active"] = json!(false);
                state["manager"]["LUNA_NEXT_MENU_SHELL"] = json!("/obsolete/checkout.qml");
                write_state(root, &state);
                menu.start().unwrap();
                assert!(
                    read_state(root)["manager"]
                        .get("LUNA_NEXT_MENU_SHELL")
                        .is_none()
                );
            }
        }
        "paths_env" => {
            let variables = [
                "XDG_CONFIG_HOME",
                "XDG_DATA_HOME",
                "XDG_STATE_HOME",
                "XDG_CACHE_HOME",
            ];
            state["manager"] = json!({"XDG_SESSION_ID": "current-session"});
            for key in variables {
                state["manager"][key] = json!("/obsolete/home");
                unsafe {
                    std::env::remove_var(key);
                }
            }
            write_state(root, &state);
            let paths = Paths::from_env().unwrap();
            fs::create_dir_all(paths.shell_path.parent().unwrap()).unwrap();
            fs::write(&paths.shell_path, "ShellRoot {}").unwrap();
            fs::create_dir_all(paths.service_file.parent().unwrap()).unwrap();
            fs::write(&paths.service_file, "[Service]\n").unwrap();
            let default = Menu::new(paths).unwrap();
            assert_eq!(default.start().unwrap(), Status::Running);
            let state = read_state(root);
            for key in variables {
                assert!(state["manager"].get(key).is_none(), "stale {key}");
            }
            assert_eq!(state["manager"]["XDG_SESSION_ID"], "current-session");
            assert_eq!(state["shell"], default.paths().shell_path.to_str().unwrap());
        }
        "paths" => {
            unsafe {
                std::env::set_var("XDG_DATA_HOME", "");
                std::env::set_var("XDG_CONFIG_HOME", "");
                std::env::set_var("LUNA_NEXT_MENU_SHELL", "");
            }
            let fallback = Menu::from_env().unwrap();
            assert_eq!(
                fallback.paths().shell_path,
                root.join("home/.local/share/luna-next/menu/shell/shell.qml")
            );
            assert_eq!(
                fallback.paths().service_file,
                root.join("home/.config/systemd/user").join(UNIT)
            );
            symlink(&menu.paths().shell_path, root.join("custom-shell.qml")).unwrap();
            unsafe {
                std::env::set_var("LUNA_NEXT_MENU_SHELL", "custom-shell.qml");
            }
            assert_eq!(
                Menu::from_env().unwrap().paths().shell_path,
                menu.paths().shell_path
            );
            unsafe {
                std::env::remove_var("HOME");
            }
            assert!(Menu::from_env().is_err());
        }
        _ => panic!("unknown scenario {name}"),
    }
    for call in read_state(root)["calls"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|call| call[0] == "systemctl")
    {
        for argument in call.as_array().unwrap().iter().filter_map(Value::as_str) {
            if argument.ends_with(".service") {
                assert_eq!(argument, UNIT);
            }
        }
    }
}
