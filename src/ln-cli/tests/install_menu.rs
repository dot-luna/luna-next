use std::{fs, path::Path, process::Command};

use serde_json::{Value, json};

#[test]
fn menu_install_links_native_runtime_and_exports_service_without_starting_it() {
    let root = tempfile::tempdir().unwrap();
    let repository = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_luna"))
        .env_clear()
        .env("HOME", root.path())
        .env("XDG_CONFIG_HOME", root.path().join("config"))
        .env("PATH", "")
        .current_dir(root.path())
        .args(["install", "--local", "menu", "--json", "--repo"])
        .arg(&repository)
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    assert!(output.stderr.is_empty(), "{output:?}");
    let response: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["ok"], true);
    assert_eq!(
        response["result"]["installed"],
        json!(["menu", "luna-menu"])
    );
    let runtime = root.path().join(".local/share/luna-next/menu");
    assert!(fs::symlink_metadata(&runtime).unwrap().is_symlink());
    assert_eq!(
        fs::canonicalize(&runtime).unwrap(),
        repository.join("src/luna-menu/src")
    );
    assert!(runtime.join("shell/shell.qml").is_file());
    let unit = root
        .path()
        .join("config/systemd/user/luna-next-menu.service");
    assert_eq!(
        fs::read(&unit).unwrap(),
        fs::read(repository.join("apps/luna-menu/config/luna-next-menu.service")).unwrap()
    );
    assert!(
        !root
            .path()
            .join("config/systemd/user/graphical-session.target.wants")
            .exists()
    );
}
