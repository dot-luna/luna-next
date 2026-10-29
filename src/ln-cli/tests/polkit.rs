use std::{fs, os::unix::fs::PermissionsExt, path::Path, process::Command};

use serde_json::{Value, json};

fn run(root: &Path, args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_lnxt"))
        .args(args)
        .env_clear()
        .env("HOME", root.join("home"))
        .env("XDG_CONFIG_HOME", root.join("config"))
        .env("XDG_DATA_HOME", root.join("data"))
        .env("PATH", root.join("bin"))
        .env("POLKIT_COMMAND_LOG", root.join("calls"))
        .current_dir(root)
        .output()
        .unwrap()
}

#[test]
fn status_and_stop_keep_tool_progress_out_of_the_json_response() {
    let root = tempfile::tempdir().unwrap();
    let bin = root.path().join("bin");
    fs::create_dir(&bin).unwrap();
    // Every external command is a fixture; no native agent or user service is addressed.
    for (name, script) in [
        ("qs", "#!/bin/sh\nexit 1\n"),
        (
            "systemctl",
            "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$POLKIT_COMMAND_LOG\"\nif test \"$2\" = is-active; then exit 3; fi\nprintf 'service progress\\n'\n",
        ),
    ] {
        let path = bin.join(name);
        fs::write(&path, script).unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    }
    for action in ["status", "stop"] {
        let output = run(root.path(), &["polkit", action, "--json"]);
        assert!(output.status.success(), "{output:?}");
        assert!(output.stderr.is_empty(), "{output:?}");
        let response: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(response, json!({"ok": true, "result": "stopped"}));
    }
    let calls = fs::read_to_string(root.path().join("calls")).unwrap();
    assert!(calls.contains("--user stop luna-next-polkit.service"));
    assert!(!calls.contains("disable"));
    assert!(!calls.contains("luna-polkit.service"));
}

#[test]
fn configure_installs_the_declared_unit_without_starting_services() {
    let root = tempfile::tempdir().unwrap();
    let repository = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let output = run(
        root.path(),
        &[
            "configure",
            "luna-polkit",
            "--repo",
            repository.to_str().unwrap(),
            "--json",
        ],
    );
    assert!(output.status.success(), "{output:?}");
    let response: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["result"]["installed"], json!(["luna-polkit"]));
    let source = repository.join("apps/luna-polkit/config/luna-next-polkit.service");
    let target = root
        .path()
        .join("config/systemd/user/luna-next-polkit.service");
    assert_eq!(fs::read(source).unwrap(), fs::read(target).unwrap());
    assert!(!root.path().join("calls").exists());
}

#[test]
fn foreground_mode_rejects_json_before_launching_a_shell() {
    let root = tempfile::tempdir().unwrap();
    let output = run(root.path(), &["polkit", "serve", "--json"]);
    assert!(!output.status.success());
    let response: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["ok"], false);
    assert!(response["error"].as_str().unwrap().contains("foreground"));
    assert!(!root.path().join("calls").exists());
}
