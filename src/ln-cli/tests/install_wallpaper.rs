use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use serde_json::{Value, json};

fn command(root: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_lnxt"));
    command
        .env_clear()
        .env("HOME", root)
        .env("XDG_CONFIG_HOME", root.join("config"))
        .env("XDG_DATA_HOME", root.join("data"))
        .current_dir(root);
    command
}

fn success(command: &mut Command) -> Value {
    let output = command.output().unwrap();
    assert!(output.status.success(), "{output:?}");
    let response: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["ok"], true, "{response}");
    response["result"].clone()
}

fn repository() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn assert_default_include(config: &Path, defaults: &Path) -> String {
    let source = fs::read_to_string(config).unwrap();
    assert_eq!(
        source
            .lines()
            .filter(|line| line.contains("include"))
            .count(),
        1
    );
    assert!(
        source.contains(&serde_json::to_string(defaults).unwrap()),
        "{source}"
    );
    source
}

#[test]
fn configure_uses_compiled_checkout_from_an_unrelated_directory() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config/luna-next/wallpaper.conf");
    let defaults = root.path().join("config/luna-next/defaults/wallpaper.conf");
    let result = success(command(root.path()).args(["configure", "luna-wallpaper", "--json"]));

    assert_eq!(result["installed"], json!(["luna-wallpaper"]));
    assert_default_include(&config, &defaults);
    assert_eq!(
        fs::read(&defaults).unwrap(),
        fs::read(repository().join("apps/luna-wallpaper/config/wallpaper.conf")).unwrap()
    );
    let resolved = success(command(root.path()).args(["wallpaper", "get-config", "--json"]));
    assert_eq!(resolved["wallpaper"]["fit"], "fill");
    assert_eq!(resolved["transition"]["duration_ms"], 200);
}

#[test]
fn wallpaper_install_links_runtime_and_schema_and_configures_managed_defaults() {
    let root = tempfile::tempdir().unwrap();
    let repo = repository();
    let config = root.path().join("config/luna-next/wallpaper.conf");
    let defaults = root.path().join("config/luna-next/defaults/wallpaper.conf");
    let runtime = root.path().join(".local/share/luna-next/wallpaper");
    let run = |arguments: &[&str]| {
        success(
            command(root.path())
                .args(arguments)
                .args(["--json", "--repo"])
                .arg(&repo),
        )
    };
    let result = run(&["install", "--local", "wallpaper"]);
    assert_eq!(result["installed"], json!(["wallpaper", "luna-wallpaper"]));
    let entry = assert_default_include(&config, &defaults);
    assert_eq!(
        fs::read(&defaults).unwrap(),
        fs::read(repo.join("apps/luna-wallpaper/config/wallpaper.conf")).unwrap()
    );
    let resolved = success(command(root.path()).args(["wallpaper", "get-config", "--json"]));
    assert_eq!(resolved["wallpaper"]["fit"], "fill");
    assert_eq!(resolved["transition"]["duration_ms"], 200);
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

    let original = format!("{entry}\nwallpaper.fit = fit\n");
    fs::write(&config, &original).unwrap();
    fs::write(&defaults, "wallpaper.fit = stretch\n").unwrap();
    run(&["install", "--local", "wallpaper"]);
    assert_eq!(fs::read_to_string(&config).unwrap(), original);
    assert_eq!(
        fs::read(&defaults).unwrap(),
        fs::read(repo.join("apps/luna-wallpaper/config/wallpaper.conf")).unwrap()
    );
    let resolved = success(command(root.path()).args(["wallpaper", "get-config", "--json"]));
    assert_eq!(resolved["wallpaper"]["fit"], "fit");
    assert_eq!(resolved["transition"]["duration_ms"], 200);
    assert!(fs::symlink_metadata(&runtime).unwrap().is_symlink());
    assert!(!root.path().join(".local/bin").exists());
}

#[test]
fn wallpaper_install_respects_absolute_and_relative_config_environment_paths() {
    for relative in [false, true] {
        let root = tempfile::tempdir().unwrap();
        let target = PathBuf::from("custom/wallpaper.conf");
        let override_path = if relative {
            target.clone()
        } else {
            root.path().join(&target)
        };
        let config = root.path().join(target);
        let defaults = root.path().join("config/luna-next/defaults/wallpaper.conf");
        let result = success(
            command(root.path())
                .env("LUNA_WALLPAPER_CONFIG", &override_path)
                .args(["install", "--local", "wallpaper", "--json", "--repo"])
                .arg(repository()),
        );
        assert_eq!(result["installed"], json!(["wallpaper", "luna-wallpaper"]));
        let entry = assert_default_include(&config, &defaults);
        assert!(!root.path().join("config/luna-next/wallpaper.conf").exists());
        let resolved = success(
            command(root.path())
                .env("LUNA_WALLPAPER_CONFIG", &override_path)
                .args(["wallpaper", "get-config", "--json"]),
        );
        assert_eq!(resolved["wallpaper"]["fit"], "fill");

        success(
            command(root.path())
                .env("LUNA_WALLPAPER_CONFIG", &override_path)
                .args(["install", "--local", "wallpaper", "--json", "--repo"])
                .arg(repository()),
        );
        assert_eq!(fs::read_to_string(config).unwrap(), entry);
    }
}
