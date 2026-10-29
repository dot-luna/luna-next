use std::{fs, path::Path, process::Command};

#[test]
fn wallpaper_install_links_runtime_and_schema_without_changing_user_settings() {
    let root = tempfile::tempdir().unwrap();
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let config_home = root.path().join("config");
    let data_home = root.path().join("data");
    let config = config_home.join("luna-next/wallpaper.conf");
    let runtime = root.path().join(".local/share/luna-next/wallpaper");
    let run = || {
        let output = Command::new(env!("CARGO_BIN_EXE_lnxt"))
            .env_clear()
            .env("HOME", root.path())
            .env("XDG_CONFIG_HOME", &config_home)
            .env("XDG_DATA_HOME", &data_home)
            .current_dir(root.path())
            .args(["install", "--local", "wallpaper", "--json", "--repo"])
            .arg(&repo)
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
        let response: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(
            response["result"]["installed"],
            serde_json::json!(["wallpaper"])
        );
    };
    run();
    assert!(!config.exists());
    assert!(fs::symlink_metadata(&runtime).unwrap().is_symlink());
    assert_eq!(
        fs::canonicalize(&runtime).unwrap(),
        fs::canonicalize(repo.join("src/luna-wallpaper/src")).unwrap()
    );
    assert!(runtime.join("shell/shell.qml").is_file());
    assert_eq!(
        fs::read(runtime.join("config.schema.json")).unwrap(),
        fs::read(repo.join("src/luna-wallpaper/src/config.schema.json")).unwrap()
    );
    fs::create_dir_all(config.parent().unwrap()).unwrap();
    let original = "# User configuration\nwallpaper.fit = fit\n";
    fs::write(&config, original).unwrap();
    run();
    assert_eq!(fs::read_to_string(config).unwrap(), original);
    assert!(!root.path().join(".local/bin").exists());
}
