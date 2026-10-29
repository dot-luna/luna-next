//! Fake Quickshell runs in isolated subprocesses; these tests never touch a desktop.

use luna_next::wallpaper::runtime::{Runtime, Status};
use serde_json::{Value, json};
use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

const FAKE_QS: &str = r#"#!/usr/bin/python3
import json, os, pathlib, sys, time
root = pathlib.Path(os.environ['LUNA_RUNTIME_TEST'])
state_path = root / 'state.json'
state = json.loads(state_path.read_text())
args = sys.argv[1:]
state['calls'].append(args)
def save(): state_path.write_text(json.dumps(state))
save()
if state.get('hang') == args[0]: time.sleep(20)
if args[0] == 'list':
    if state.get('bad_list'):
        print('{bad json')
    elif not state['instances']:
        print('No running instances.')
    else:
        print(json.dumps(state['instances']))
elif args[0] == 'kill':
    pid = int(args[args.index('--pid') + 1])
    if state.get('kill_error'):
        print('could not kill', file=sys.stderr)
        sys.exit(1)
    state['instances'] = [item for item in state['instances'] if item['pid'] != pid]
    save()
elif args[0] == 'ipc':
    if args[5] == 'reload':
        if state.get('reload_error'):
            print('reload IPC failed', file=sys.stderr)
            sys.exit(1)
        if 'reload_status' in state:
            state['status'] = state['reload_status']
        state['loading'] = state.get('reload_loading', 0)
        save()
        print(state.get('reload_response', 'ok'))
        sys.exit(0)
    if state.get('ipc_pending', 0) > 0:
        state['ipc_pending'] -= 1
        save()
        sys.exit(1)
    if state.get('loading', 0) > 0:
        state['loading'] -= 1
        save()
        print('loading')
    elif state.get('disappear'):
        state['instances'] = [item for item in state['instances'] if item['pid'] == 999]
        save()
        print('loading')
    else:
        print(state.get('status', 'ready'))
else:
    if state.get('start_error'):
        print('launcher failed', file=sys.stderr)
        sys.exit(1)
    path = args[args.index('-p') + 1]
    state['instances'].append({'config_path': path, 'pid': 123})
    state['config'] = os.environ.get('LUNA_WALLPAPER_CONFIG')
    state['imports'] = os.environ.get('QML_IMPORT_PATH')
    state['detached_group'] = os.getpid() == os.getpgrp()
    save()
"#;

fn read_state(root: &Path) -> Value {
    serde_json::from_slice(&fs::read(root.join("state.json")).unwrap()).unwrap()
}

fn write_state(root: &Path, state: &Value) {
    fs::write(root.join("state.json"), serde_json::to_vec(state).unwrap()).unwrap();
}

fn fixture_state(root: &Path, running: bool) -> Value {
    let mut instances = vec![json!({"config_path":root.join("unrelated.qml"),"pid":999})];
    if running {
        instances.push(json!({"config_path":root.join("alias.qml"),"pid":123}));
    }
    json!({"instances":instances,"calls":[]})
}

fn scenario(name: &str) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    fs::create_dir(root.join("bin")).unwrap();
    fs::write(root.join("shell.qml"), "import Quickshell\nShellRoot {}\n").unwrap();
    fs::write(root.join("unrelated.qml"), "").unwrap();
    symlink(root.join("shell.qml"), root.join("alias.qml")).unwrap();
    let executable = root.join("bin/qs");
    fs::write(&executable, FAKE_QS).unwrap();
    fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args(["--exact", "runtime_scenario", "--nocapture"])
        .env("LUNA_RUNTIME_TEST", root)
        .env("LUNA_RUNTIME_SCENARIO", name)
        .env("PATH", root.join("bin"))
        .env("WAYLAND_DISPLAY", "fake-test-display")
        .env("QML_IMPORT_PATH", "/preserved/imports")
        .current_dir(root);
    if name == "bad_context" {
        command.env_remove("WAYLAND_DISPLAY");
    }
    let result = command.output().unwrap();
    assert!(
        result.status.success(),
        "{name}:\n{}\n{}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
}

#[test]
fn lifecycle_scopes_instances_and_reuses_the_existing_renderer() {
    scenario("lifecycle");
}

#[test]
fn restart_replaces_the_renderer_and_passes_the_configuration_path() {
    scenario("restart");
}

#[test]
fn reload_keeps_matching_processes_and_passes_an_absolute_configuration_path() {
    scenario("reload");
}

#[test]
fn reload_starts_a_stopped_renderer() {
    scenario("reload_stopped");
}

#[test]
fn reload_requires_acceptance_and_waits_for_media_without_replacing_processes() {
    scenario("reload_rejected");
    scenario("reload_bad_response");
    scenario("reload_ipc_failure");
    scenario("reload_media_failure");
}

#[test]
fn launch_and_media_failures_are_errors() {
    scenario("launch_failure");
    scenario("media_failure");
    scenario("renderer_exit");
}

#[test]
fn malformed_status_and_instance_lists_are_errors() {
    scenario("bad_status");
    scenario("bad_list");
}

#[test]
fn stopped_is_idempotent_and_missing_renderer_is_safe() {
    scenario("missing_renderer");
}

#[test]
fn restart_checks_its_context_before_stopping_a_working_renderer() {
    scenario("bad_context");
}

#[test]
fn a_quickshell_command_cannot_wait_forever() {
    scenario("command_timeout");
}

#[test]
fn failed_kill_does_not_target_an_unrelated_process() {
    scenario("kill_failure");
}

// A subprocess isolates PATH and session variables from parallel Cargo tests.
#[test]
fn runtime_scenario() {
    let Some(root) = std::env::var_os("LUNA_RUNTIME_TEST").map(PathBuf::from) else {
        return;
    };
    let name = std::env::var("LUNA_RUNTIME_SCENARIO").unwrap();
    let runtime = Runtime::new(root.join("shell.qml"), root.join("config/wallpaper.conf"));
    let running = !matches!(
        name.as_str(),
        "launch_failure" | "media_failure" | "missing_renderer" | "reload_stopped"
    );
    let mut state = fixture_state(&root, running);
    match name.as_str() {
        "lifecycle" => {
            state["ipc_pending"] = json!(1);
            state["loading"] = json!(1);
            write_state(&root, &state);
            assert_eq!(runtime.start().unwrap(), Status::Ready);
            assert_eq!(runtime.status().unwrap(), Status::Ready);
            assert_eq!(runtime.stop().unwrap(), Status::Stopped);
            assert_eq!(runtime.stop().unwrap(), Status::Stopped);
            let state = read_state(&root);
            assert_eq!(state["instances"].as_array().unwrap().len(), 1);
            assert_eq!(state["instances"][0]["pid"], 999);
            assert!(
                state["calls"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|call| call[0] != "-p")
            );
        }
        "restart" => {
            write_state(&root, &state);
            assert_eq!(runtime.restart().unwrap(), Status::Ready);
            let state = read_state(&root);
            assert_eq!(
                state["config"],
                root.join("config/wallpaper.conf").to_str().unwrap()
            );
            assert_eq!(state["imports"], "/preserved/imports");
            assert_eq!(state["detached_group"], true);
            let calls = state["calls"].as_array().unwrap();
            let kill = calls.iter().position(|call| call[0] == "kill").unwrap();
            let launch = calls.iter().position(|call| call[0] == "-p").unwrap();
            assert!(kill < launch);
            assert!(
                calls[launch]
                    .as_array()
                    .unwrap()
                    .contains(&json!("--daemonize"))
            );
            assert!(
                calls[launch]
                    .as_array()
                    .unwrap()
                    .contains(&json!("--no-duplicate"))
            );
        }
        "reload" => {
            state["instances"]
                .as_array_mut()
                .unwrap()
                .push(json!({"config_path":root.join("shell.qml"),"pid":456}));
            let original_instances = state["instances"].clone();
            state["reload_loading"] = json!(1);
            write_state(&root, &state);
            let relative = Runtime::new(root.join("shell.qml"), "config/wallpaper.conf".into());
            assert_eq!(relative.reload().unwrap(), Status::Ready);
            let state = read_state(&root);
            assert_eq!(state["instances"], original_instances);
            let calls = state["calls"].as_array().unwrap();
            let reloads: Vec<_> = calls
                .iter()
                .filter(|call| call[0] == "ipc" && call[5] == "reload")
                .collect();
            let config = root.join("config/wallpaper.conf");
            assert_eq!(
                reloads,
                vec![
                    &json!(["ipc", "--pid", "123", "call", "wallpaper", "reload", config]),
                    &json!(["ipc", "--pid", "456", "call", "wallpaper", "reload", config])
                ]
            );
            assert!(
                calls
                    .iter()
                    .all(|call| call[0] != "kill" && call[0] != "-p")
            );
            assert_eq!(state["loading"], 0);
        }
        "reload_stopped" => {
            write_state(&root, &state);
            assert_eq!(runtime.reload().unwrap(), Status::Ready);
            let state = read_state(&root);
            assert_eq!(state["instances"].as_array().unwrap().len(), 2);
            assert_eq!(state["instances"][0]["pid"], 999);
            assert_eq!(
                state["config"],
                root.join("config/wallpaper.conf").to_str().unwrap()
            );
            let calls = state["calls"].as_array().unwrap();
            assert_eq!(calls.iter().filter(|call| call[0] == "-p").count(), 1);
            assert!(calls.iter().all(|call| call[0] != "kill"));
        }
        "reload_rejected"
        | "reload_bad_response"
        | "reload_ipc_failure"
        | "reload_media_failure" => {
            let expected = match name.as_str() {
                "reload_rejected" => {
                    state["reload_response"] = json!("error: invalid configuration");
                    "invalid configuration"
                }
                "reload_bad_response" => {
                    state["reload_response"] = json!("ready");
                    "Could not reload wallpaper"
                }
                "reload_ipc_failure" => {
                    state["reload_error"] = json!(true);
                    "reload IPC failed"
                }
                _ => {
                    state["reload_status"] = json!("error");
                    state["reload_loading"] = json!(1);
                    "configuration or media"
                }
            };
            let original_instances = state["instances"].clone();
            write_state(&root, &state);
            assert!(runtime.reload().unwrap_err().to_string().contains(expected));
            let state = read_state(&root);
            assert_eq!(state["instances"], original_instances);
            assert!(
                state["calls"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|call| call[0] != "kill" && call[0] != "-p")
            );
        }
        "launch_failure" => {
            state["start_error"] = json!(true);
            write_state(&root, &state);
            assert!(
                runtime
                    .start()
                    .unwrap_err()
                    .to_string()
                    .contains("launcher failed")
            );
        }
        "media_failure" => {
            state["status"] = json!("error");
            write_state(&root, &state);
            assert!(
                runtime
                    .start()
                    .unwrap_err()
                    .to_string()
                    .contains("configuration or media")
            );
            assert_eq!(runtime.status().unwrap(), Status::Error);
        }
        "renderer_exit" => {
            state["disappear"] = json!(true);
            write_state(&root, &state);
            assert!(runtime.start().unwrap_err().to_string().contains("exited"));
        }
        "bad_status" => {
            state["status"] = json!("bogus");
            write_state(&root, &state);
            assert!(
                runtime
                    .status()
                    .unwrap_err()
                    .to_string()
                    .contains("Invalid wallpaper status")
            );
        }
        "bad_list" => {
            state["bad_list"] = json!(true);
            write_state(&root, &state);
            assert!(
                runtime
                    .stop()
                    .unwrap_err()
                    .to_string()
                    .contains("Invalid Quickshell instance list")
            );
        }
        "missing_renderer" => {
            write_state(&root, &state);
            let missing =
                Runtime::new(root.join("absent/deep/shell.qml"), root.join("config.conf"));
            assert_eq!(missing.status().unwrap(), Status::Stopped);
            assert_eq!(missing.stop().unwrap(), Status::Stopped);
            assert!(
                missing
                    .start()
                    .unwrap_err()
                    .to_string()
                    .contains("not found")
            );
        }
        "bad_context" => {
            write_state(&root, &state);
            assert!(
                runtime
                    .restart()
                    .unwrap_err()
                    .to_string()
                    .contains("Wayland")
            );
            let state = read_state(&root);
            assert_eq!(state["calls"], json!([]));
            assert_eq!(state["instances"].as_array().unwrap().len(), 2);
        }
        "command_timeout" => {
            state["hang"] = json!("list");
            write_state(&root, &state);
            let began = Instant::now();
            assert!(
                runtime
                    .status()
                    .unwrap_err()
                    .to_string()
                    .contains("timed out")
            );
            assert!(began.elapsed() < Duration::from_secs(8));
        }
        "kill_failure" => {
            state["kill_error"] = json!(true);
            write_state(&root, &state);
            assert!(
                runtime
                    .stop()
                    .unwrap_err()
                    .to_string()
                    .contains("could not kill")
            );
            let state = read_state(&root);
            let kills: Vec<_> = state["calls"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|call| call[0] == "kill")
                .collect();
            assert_eq!(kills, vec![&json!(["kill", "--pid", "123"])]);
        }
        _ => panic!("Unexpected scenario {name}"),
    }
}
