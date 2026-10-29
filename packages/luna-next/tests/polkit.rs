//! Fake commands run in subprocesses, isolated from the user's services and session.

use std::{
    fs,
    os::unix::fs::{PermissionsExt, symlink},
    path::Path,
    process::Command,
    time::{Duration, Instant},
};

use luna_next::polkit::{Paths, Polkit, Status, UNIT};
use serde_json::{Value, json};

const COMMAND: &str = r#"#!/usr/bin/python3
import json, os, pathlib, sys, time
root = pathlib.Path(os.environ['LUNA_POLKIT_TEST'])
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
        state['registered'] = not state.get('registration_failure', False)
        state['launched'] = True
        state['pending'] = state.get('registration_pending', 0)
    if action in ('stop', 'disable'):
        state['active'] = state['registered'] = False
    if action == 'enable': state['enabled'] = True
    if action == 'disable': state['enabled'] = False
    save()
elif args[0] == 'ipc':
    if state.get('launched') and state.get('hang_ipc'): time.sleep(20)
    if not state.get('active'): sys.exit(1)
    if state.get('pending', 0):
        state['pending'] -= 1
        save()
        print('unavailable')
        sys.exit(0)
    print('running' if state.get('registered') else 'unavailable')
else:
    state['theme'] = json.loads(os.environ['LUNA_NEXT_POLKIT_THEME'])
    state['validating'] = os.environ.get('LUNA_NEXT_POLKIT_VALIDATE')
    state['shell'] = args[1]
    save()
    if state['validating'] == '1':
        if state.get('hang_validation'): time.sleep(20)
        if not state.get('missing_marker'):
            print('Luna Next polkit validation passed', file=sys.stderr)
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
    fs::create_dir_all(root.join("data/luna-next/polkit/shell")).unwrap();
    fs::write(
        root.join("data/luna-next/polkit/shell/shell.qml"),
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
        &json!({"calls": [], "active": false, "registered": false}),
    );
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args(["--exact", "polkit_scenario", "--nocapture"])
        .env("LUNA_POLKIT_TEST", root)
        .env("LUNA_POLKIT_SCENARIO", name)
        .env("HOME", root.join("home"))
        .env("XDG_CONFIG_HOME", root.join("config"))
        .env("XDG_DATA_HOME", root.join("data"))
        .env("XDG_STATE_HOME", root.join("state"))
        .env("XDG_CACHE_HOME", root.join("cache"))
        .env("PATH", root.join("bin"))
        .env("WAYLAND_DISPLAY", "polkit-test-display")
        .env("QML_IMPORT_PATH", "/test/qml-imports")
        .env_remove("LUNA_NEXT_POLKIT_SHELL")
        .env_remove("LUNA_NEXT_POLKIT_THEME")
        .env_remove("LUNA_NEXT_POLKIT_VALIDATE")
        .current_dir(root);
    if name == "serve" {
        command.env("LUNA_NEXT_POLKIT_VALIDATE", "1");
    }
    let result = command.output().unwrap();
    assert!(
        result.status.success(),
        "{name}:\n{}\n{}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
    if name == "serve" {
        let state = read_state(root);
        assert!(state["validating"].is_null());
        assert_eq!(state["theme"]["fonts"]["ui"], "Outfit");
        assert_eq!(state["calls"].as_array().unwrap().len(), 1);
    }
}

#[test]
fn start_validates_imports_session_and_waits_for_native_registration() {
    scenario("start");
}

#[test]
fn healthy_start_keeps_a_prompt_running_even_with_invalid_new_theme() {
    scenario("healthy");
}

#[test]
fn validation_failure_keeps_running_service_untouched() {
    scenario("invalid_qml");
    scenario("missing_marker");
    scenario("invalid_theme");
}

#[test]
fn restart_validates_before_replacing_the_agent() {
    scenario("restart");
}

#[test]
fn stop_leaves_login_enabled_and_does_not_load_theme() {
    scenario("stop");
}

#[test]
fn status_distinguishes_registration_service_and_bus_failure() {
    scenario("status");
}

#[test]
fn unsuccessful_start_is_stopped_and_reports_early_exit() {
    scenario("exit_early");
}

#[test]
fn missing_installation_and_session_fail_before_service_changes() {
    scenario("missing_unit");
    scenario("missing_shell");
    scenario("missing_session");
}

#[test]
fn serve_passes_theme_and_removes_validation_mode_before_exec() {
    scenario("serve");
}

#[test]
fn stalled_validation_is_bounded_without_service_changes() {
    scenario("hang_validation");
}

#[test]
fn stalled_registration_command_is_bounded_and_stops_the_new_service() {
    scenario("hang_ipc");
}

#[test]
fn polkit_scenario() {
    let Some(name) = std::env::var_os("LUNA_POLKIT_SCENARIO") else {
        return;
    };
    let root = std::env::var_os("LUNA_POLKIT_TEST").unwrap();
    let root = Path::new(&root);
    let polkit = Polkit::from_env().unwrap();
    assert_eq!(
        polkit.paths().shell_path,
        root.join("data/luna-next/polkit/shell/shell.qml")
    );
    assert_eq!(
        polkit.paths().service_file,
        root.join("config/systemd/user").join(UNIT)
    );
    let mut state = read_state(root);
    match name.to_str().unwrap() {
        "start" => {
            state["registration_pending"] = json!(2);
            write_state(root, &state);
            assert_eq!(polkit.start().unwrap(), Status::Running);
            let state = read_state(root);
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
                "XDG_STATE_HOME",
                "XDG_CACHE_HOME",
                "QML_IMPORT_PATH",
            ] {
                assert!(import.as_array().unwrap().contains(&json!(variable)));
            }
        }
        "healthy" | "invalid_qml" | "missing_marker" | "invalid_theme" => {
            state["active"] = json!(true);
            state["registered"] = json!(true);
            let name = name.to_str().unwrap();
            if name == "invalid_theme" || name == "healthy" {
                fs::create_dir_all(root.join("config/luna-next")).unwrap();
                fs::write(root.join("config/luna-next/theme.conf"), "broken = [").unwrap();
            } else {
                state[name] = json!(true);
            }
            write_state(root, &state);
            if name == "healthy" {
                assert_eq!(polkit.start().unwrap(), Status::Running);
            } else {
                assert!(polkit.restart().is_err());
            }
            let state = read_state(root);
            assert_eq!(state["active"], true);
            assert_eq!(state["registered"], true);
            let service_calls: Vec<_> = state["calls"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|call| call[0] == "systemctl")
                .cloned()
                .collect();
            if name == "healthy" {
                assert_eq!(
                    service_calls,
                    vec![json!(["systemctl", "--user", "enable", UNIT])]
                );
                assert_eq!(state["enabled"], true);
            } else {
                assert!(service_calls.is_empty());
            }
        }
        "restart" => {
            state["active"] = json!(true);
            state["registered"] = json!(true);
            write_state(root, &state);
            assert_eq!(polkit.restart().unwrap(), Status::Running);
            let calls = read_state(root)["calls"].as_array().unwrap().clone();
            assert_eq!(calls[0][1], "-p");
            assert!(calls.iter().any(|call| call[2] == "restart"));
        }
        "stop" => {
            // Stop deliberately bypasses theme and launch validation.
            state["enabled"] = json!(true);
            write_state(root, &state);
            unsafe {
                std::env::remove_var("WAYLAND_DISPLAY");
            }
            assert_eq!(polkit.stop().unwrap(), Status::Stopped);
            assert_eq!(
                read_state(root)["calls"],
                json!([["systemctl", "--user", "stop", UNIT]])
            );
            assert_eq!(read_state(root)["enabled"], true);
        }
        "status" => {
            assert_eq!(polkit.status().unwrap(), Status::Stopped);
            state["active"] = json!(true);
            write_state(root, &state);
            assert_eq!(polkit.status().unwrap(), Status::Unavailable);
            state["registered"] = json!(true);
            write_state(root, &state);
            assert_eq!(polkit.status().unwrap(), Status::Running);
            state["active"] = json!(false);
            state["bus_error"] = json!(true);
            write_state(root, &state);
            assert!(
                polkit
                    .status()
                    .unwrap_err()
                    .to_string()
                    .contains("Cannot connect to bus")
            );
        }
        "exit_early" => {
            state["exit_early"] = json!(true);
            write_state(root, &state);
            assert!(
                polkit
                    .start()
                    .unwrap_err()
                    .to_string()
                    .contains("exited before registering")
            );
            assert_eq!(
                read_state(root)["calls"]
                    .as_array()
                    .unwrap()
                    .last()
                    .unwrap()[2],
                "stop"
            );
        }
        "missing_unit" | "missing_shell" | "missing_session" => {
            match name.to_str().unwrap() {
                "missing_unit" => fs::remove_file(&polkit.paths().service_file).unwrap(),
                "missing_shell" => fs::remove_file(&polkit.paths().shell_path).unwrap(),
                _ => unsafe {
                    std::env::remove_var("WAYLAND_DISPLAY");
                },
            }
            assert!(polkit.start().is_err());
            assert!(
                !read_state(root)["calls"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|call| call[0] == "systemctl")
            );
        }
        "serve" => polkit.serve().unwrap(),
        "override_env" => {
            unsafe {
                std::env::set_var("LUNA_NEXT_POLKIT_SHELL", &polkit.paths().shell_path);
            }
            polkit.start().unwrap();
            assert_eq!(
                read_state(root)["manager"]["LUNA_NEXT_POLKIT_SHELL"],
                polkit.paths().shell_path.to_str().unwrap()
            );
            for unset in [None, Some("")] {
                unsafe {
                    match unset {
                        None => std::env::remove_var("LUNA_NEXT_POLKIT_SHELL"),
                        Some(value) => std::env::set_var("LUNA_NEXT_POLKIT_SHELL", value),
                    }
                }
                let mut state = read_state(root);
                state["active"] = json!(false);
                state["registered"] = json!(false);
                state["manager"]["LUNA_NEXT_POLKIT_SHELL"] = json!("/obsolete/checkout.qml");
                write_state(root, &state);
                polkit.start().unwrap();
                assert!(
                    read_state(root)["manager"]
                        .get("LUNA_NEXT_POLKIT_SHELL")
                        .is_none()
                );
            }
        }
        "paths" => {
            // This subprocess is the only consumer of these environment changes.
            unsafe {
                std::env::set_var("XDG_DATA_HOME", "");
                std::env::set_var("XDG_CONFIG_HOME", "");
                std::env::set_var("LUNA_NEXT_POLKIT_SHELL", "");
            }
            let fallback = Polkit::from_env().unwrap();
            assert_eq!(
                fallback.paths().shell_path,
                root.join("home/.local/share/luna-next/polkit/shell/shell.qml")
            );
            assert_eq!(
                fallback.paths().service_file,
                root.join("home/.config/systemd/user").join(UNIT)
            );
            symlink(&polkit.paths().shell_path, root.join("custom-shell.qml")).unwrap();
            unsafe {
                std::env::set_var("LUNA_NEXT_POLKIT_SHELL", "custom-shell.qml");
            }
            assert_eq!(
                Polkit::from_env().unwrap().paths().shell_path,
                polkit.paths().shell_path
            );
            unsafe {
                std::env::remove_var("HOME");
            }
            assert!(Polkit::from_env().is_err());
        }
        "paths_env" => {
            let variables = [
                "XDG_CONFIG_HOME",
                "XDG_DATA_HOME",
                "XDG_STATE_HOME",
                "XDG_CACHE_HOME",
            ];
            state["manager"] = json!({"XDG_SESSION_ID": "current-session"});
            unsafe {
                std::env::remove_var("XDG_SESSION_ID");
            }
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
            let default = Polkit::new(paths).unwrap();
            assert_eq!(default.start().unwrap(), Status::Running);
            let state = read_state(root);
            for key in variables {
                assert!(state["manager"].get(key).is_none(), "stale {key}");
            }
            assert_eq!(state["manager"]["XDG_SESSION_ID"], "current-session");
            assert_eq!(state["shell"], default.paths().shell_path.to_str().unwrap());
        }
        "hang_validation" | "hang_ipc" => {
            state[name.to_str().unwrap()] = json!(true);
            write_state(root, &state);
            let start = Instant::now();
            assert!(
                polkit
                    .start()
                    .unwrap_err()
                    .to_string()
                    .contains("timed out")
            );
            assert!(start.elapsed() < Duration::from_secs(14));
            let state = read_state(root);
            if name == "hang_validation" {
                assert!(
                    !state["calls"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|call| call[0] == "systemctl")
                );
            } else {
                assert_eq!(
                    state["calls"].as_array().unwrap().last().unwrap()[2],
                    "stop"
                );
            }
        }
        _ => panic!("unknown scenario"),
    }
    let calls = read_state(root)["calls"].as_array().unwrap().clone();
    for call in calls.iter().filter(|call| call[0] == "systemctl") {
        // Lifecycle code has no ownership over other agents or user units.
        for argument in call.as_array().unwrap().iter().filter_map(Value::as_str) {
            if argument.ends_with(".service") {
                assert_eq!(argument, UNIT);
            }
        }
    }
}

#[test]
fn explicit_paths_reject_empty_values() {
    assert!(
        Polkit::new(Paths {
            shell_path: "".into(),
            service_file: "unit".into()
        })
        .is_err()
    );
    assert!(
        Polkit::new(Paths {
            shell_path: "shell".into(),
            service_file: "".into()
        })
        .is_err()
    );
}

#[test]
fn environment_paths_support_xdg_fallbacks_and_nonempty_shell_override() {
    scenario("paths");
}

#[test]
fn leaving_a_shell_override_clears_its_previous_systemd_environment_value() {
    scenario("override_env");
}

#[test]
fn default_homes_clear_stale_manager_paths_without_removing_session_identity() {
    scenario("paths_env");
}
