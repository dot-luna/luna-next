use std::{fs, os::unix::fs::symlink, path::Path, process::Command};

use serde_json::{Value, json};

#[test]
fn hypr_configure_replaces_exported_modules_and_managed_startup_entry() {
    let root = tempfile::Builder::new()
        .prefix("lnxt hypr ' ")
        .tempdir()
        .unwrap();
    let config_home = root.path().join("config");
    let personal = config_home.join("hypr/hyprland.lua");
    fs::create_dir_all(personal.parent().unwrap()).unwrap();
    fs::write(&personal, "-- personal Lua settings\n").unwrap();
    let repository = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    let source = repository.join("apps/hypr/config");
    let target = config_home.join("luna-next/hypr");
    let configure = || {
        let output = Command::new(env!("CARGO_BIN_EXE_lnxt"))
            .env_clear()
            .env("HOME", root.path().join("home"))
            .env("XDG_CONFIG_HOME", &config_home)
            .current_dir(root.path())
            .args(["configure", "hypr", "--json", "--repo"])
            .arg(&repository)
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
        assert!(output.stderr.is_empty(), "{output:?}");
        let response: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(response["ok"], true, "{response}");
        response["result"].clone()
    };

    assert_eq!(configure()["installed"], json!(["hypr"]));
    let mut directories = vec![source.clone()];
    let mut exported = 0;
    while let Some(directory) = directories.pop() {
        for entry in fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                directories.push(path);
            } else {
                let installed = target.join(path.strip_prefix(&source).unwrap());
                assert_eq!(fs::read(&installed).unwrap(), fs::read(&path).unwrap());
                exported += 1;
            }
        }
    }
    assert!(exported > 1);
    assert_eq!(
        fs::read_to_string(&personal).unwrap(),
        fs::read_to_string(source.join("entry.lua")).unwrap()
    );
    let input = target.join("input.lua");
    fs::write(&input, "-- customized input settings\n").unwrap();
    let appearance = target.join("appearance.lua");
    let custom_appearance = root.path().join("personal-appearance.lua");
    fs::write(&custom_appearance, "-- customized appearance\n").unwrap();
    fs::remove_file(&appearance).unwrap();
    symlink(&custom_appearance, &appearance).unwrap();
    let obsolete = target.join("obsolete.lua");
    fs::write(&obsolete, "-- removed configuration module\n").unwrap();
    let result = configure();
    assert_eq!(result["installed"], json!(["hypr"]));
    assert_eq!(result["skipped"], json!([]));
    assert_eq!(
        fs::read(&input).unwrap(),
        fs::read(source.join("input.lua")).unwrap()
    );
    assert!(!fs::symlink_metadata(&appearance).unwrap().is_symlink());
    assert_eq!(
        fs::read(&appearance).unwrap(),
        fs::read(source.join("appearance.lua")).unwrap()
    );
    assert_eq!(
        fs::read_to_string(&custom_appearance).unwrap(),
        "-- customized appearance\n"
    );
    assert!(!obsolete.exists());
    assert_eq!(
        fs::read_to_string(&personal).unwrap(),
        fs::read_to_string(source.join("entry.lua")).unwrap()
    );
}
