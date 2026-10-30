use std::{
    fs,
    io::Write,
    os::unix::fs::PermissionsExt,
    path::Path,
    process::{Command, Stdio},
};

use serde_json::{Value, json};

const SOCKET: &str = "gnome-keyring-daemon.socket";
const SUCCESS: &str = "GNOME Keyring socket enabled.";
const SYSTEMCTL: &str = r#"#!/bin/sh
printf '%s\n' "$*" >> "$KEYRING_COMMAND_LOG"
printf 'socket progress\n'
printf 'socket diagnostic\n' >&2
if IFS= read -r input; then
    printf 'Unexpected input reached systemctl\n' >&2
    exit 91
fi
exit "${KEYRING_EXIT_STATUS:-0}"
"#;

fn sandbox(with_systemctl: bool) -> tempfile::TempDir {
    let root = tempfile::tempdir().unwrap();
    let bin = root.path().join("bin");
    fs::create_dir(&bin).unwrap();
    if with_systemctl {
        let executable = bin.join("systemctl");
        fs::write(&executable, SYSTEMCTL).unwrap();
        fs::set_permissions(executable, fs::Permissions::from_mode(0o755)).unwrap();
    }
    root
}

fn command(root: &Path, arguments: &[&str]) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_luna"));
    // Only the fixture can be resolved; no real user manager or keyring is reachable.
    command
        .args(arguments)
        .env_clear()
        .env("HOME", root.join("home"))
        .env("PATH", root.join("bin"))
        .env("LC_ALL", "C")
        .env("KEYRING_COMMAND_LOG", root.join("calls"))
        .current_dir(root)
        .stdin(Stdio::null());
    command
}

#[test]
fn setup_enables_the_vendor_socket_repeatedly_without_restarting_the_daemon() {
    let root = sandbox(true);
    for json_output in [true, false] {
        let mut arguments = vec!["keyring", "setup"];
        if json_output {
            arguments.push("--json");
        }
        let output = command(root.path(), &arguments).output().unwrap();
        assert!(output.status.success(), "{output:?}");
        if json_output {
            let response: Value = serde_json::from_slice(&output.stdout).unwrap();
            assert_eq!(response, json!({"ok": true, "result": SUCCESS}));
        } else {
            assert_eq!(
                String::from_utf8(output.stdout).unwrap(),
                format!("{SUCCESS}\n")
            );
        }
        let progress = String::from_utf8(output.stderr).unwrap();
        assert!(progress.contains("socket progress"), "{progress}");
        assert!(progress.contains("socket diagnostic"), "{progress}");
    }
    assert_eq!(
        fs::read_to_string(root.path().join("calls")).unwrap(),
        format!("--user enable --now {SOCKET}\n--user enable --now {SOCKET}\n")
    );
}

#[test]
fn setup_does_not_pass_cli_input_to_systemctl() {
    let root = sandbox(true);
    let mut child = command(root.path(), &["keyring", "setup", "--json"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(b"test input that must stay outside the helper\n")
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success(), "{output:?}");
    let response: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response, json!({"ok": true, "result": SUCCESS}));
}

#[test]
fn setup_reports_socket_activation_failure_without_corrupting_json() {
    let root = sandbox(true);
    let output = command(root.path(), &["keyring", "setup", "--json"])
        .env("KEYRING_EXIT_STATUS", "17")
        .output()
        .unwrap();
    assert!(!output.status.success(), "{output:?}");
    let response: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["ok"], false);
    let error = response["error"].as_str().unwrap();
    assert!(error.contains(SOCKET), "{error}");
    assert!(error.contains("17"), "{error}");
    assert!(
        String::from_utf8(output.stderr)
            .unwrap()
            .contains("socket progress")
    );
}

#[test]
fn setup_names_the_missing_systemctl_command_and_socket() {
    let root = sandbox(false);
    let output = command(root.path(), &["keyring", "setup", "--json"])
        .output()
        .unwrap();
    assert!(!output.status.success(), "{output:?}");
    let response: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["ok"], false);
    let error = response["error"].as_str().unwrap();
    assert!(error.contains("systemctl"), "{error}");
    assert!(error.contains(SOCKET), "{error}");
    assert!(!root.path().join("calls").exists());
}
