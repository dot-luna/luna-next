use serde_json::Value;
use std::{
    fs,
    os::unix::fs::{PermissionsExt, symlink},
    path::{Path, PathBuf},
    process::{Command, Output},
};

struct Sandbox {
    root: tempfile::TempDir,
}

impl Sandbox {
    fn new() -> Self {
        let root = tempfile::Builder::new()
            .prefix("luna shell configs ' ")
            .tempdir()
            .unwrap();
        for folder in ["home", "bin"] {
            fs::create_dir(root.path().join(folder)).unwrap();
        }
        symlink(env!("CARGO_BIN_EXE_luna"), root.path().join("bin/luna")).unwrap();
        let mise = root.path().join("bin/mise");
        fs::write(&mise, "#!/bin/sh\nprintf '# fixture completion\\n'\n").unwrap();
        fs::set_permissions(mise, fs::Permissions::from_mode(0o755)).unwrap();
        Self { root }
    }

    fn config(&self) -> PathBuf {
        self.root.path().join("config")
    }

    fn command(&self) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_luna"));
        command
            .env_clear()
            .env("HOME", self.root.path().join("home"))
            .env("XDG_CONFIG_HOME", self.config())
            .env("XDG_DATA_HOME", self.root.path().join("data"))
            .env(
                "PATH",
                format!("{}:/usr/bin:/bin", self.root.path().join("bin").display()),
            )
            .current_dir(self.root.path());
        command
    }

    fn configure(&self, names: &[&str]) -> Command {
        let repository = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let mut command = self.command();
        command
            .args(["configure", "--json", "--repo"])
            .arg(repository)
            .args(names);
        command
    }

    fn select_custom_theme(&self) -> PathBuf {
        let theme = self
            .root
            .path()
            .join("data/luna-next/themes/custom/theme.conf");
        write(
            &theme,
            "# original theme source\ncolors { background = \"#112233\", accent = \"#345678\", info = \"#456789\" }\nfonts { mono = \"DejaVu Sans Mono\" }\n",
        );
        write(
            self.config().join("luna-next/theme.conf"),
            "theme { name = custom }\n",
        );
        theme
    }
}

fn write(path: impl AsRef<Path>, text: &str) {
    let path = path.as_ref();
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

fn success(output: Output) -> Value {
    assert!(output.status.success(), "{output:?}");
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["ok"], true, "{value}");
    value["result"].clone()
}

#[test]
fn real_app_descriptors_generate_the_selected_theme_and_replace_owned_exports() {
    let sandbox = Sandbox::new();
    let source = sandbox.select_custom_theme();
    let original = fs::read(&source).unwrap();
    write(sandbox.config().join("kitty/obsolete.conf"), "old kitty\n");
    write(
        sandbox.config().join("luna-next/zsh/obsolete.zsh"),
        "old shell\n",
    );
    write(sandbox.config().join("unrelated.conf"), "keep\n");
    let external = sandbox.root.path().join("external startup");
    write(&external, "personal file\n");
    symlink(&external, sandbox.root.path().join("home/.zshrc")).unwrap();

    let report = success(
        sandbox
            .configure(&["kitty", "zsh", "starship"])
            .output()
            .unwrap(),
    );
    assert_eq!(
        report["installed"],
        serde_json::json!(["kitty", "starship", "zsh"])
    );
    let kitty = sandbox.config().join("kitty/generated/theme.conf");
    let native = fs::read_to_string(&kitty).unwrap();
    assert!(native.contains("background #112233\n"), "{native}");
    assert!(native.contains("cursor #345678\n"), "{native}");
    assert!(
        native.contains("font_family DejaVu Sans Mono\n"),
        "{native}"
    );
    let starship = fs::read_to_string(sandbox.config().join("starship.toml")).unwrap();
    assert!(starship.contains("palette = \"luna_next\""));
    assert!(starship.contains("cyan = \"#456789\""));
    assert!(!starship.contains("{{"));
    assert!(!sandbox.config().join("kitty/obsolete.conf").exists());
    assert!(!sandbox.config().join("luna-next/zsh/obsolete.zsh").exists());
    assert_eq!(
        fs::read_to_string(sandbox.config().join("unrelated.conf")).unwrap(),
        "keep\n"
    );
    assert_eq!(fs::read_to_string(&external).unwrap(), "personal file\n");
    let startup = fs::read_to_string(sandbox.root.path().join("home/.zshrc")).unwrap();
    assert!(startup.contains("/luna-next/zsh/zshrc"));
    assert!(!sandbox.config().join(".zshrc").exists());
    assert!(
        sandbox
            .config()
            .join("luna-next/zsh/generated/mise-completion.zsh")
            .is_file()
    );
    assert_eq!(fs::read(&source).unwrap(), original);

    write(&source, "colors { background = \"#223344\" }\n");
    success(sandbox.configure(&["kitty", "starship"]).output().unwrap());
    let native = fs::read_to_string(kitty).unwrap();
    assert!(native.contains("background #223344\n"));
    assert!(native.contains("font_family Iosevka Nerd Font\n"));
}

#[test]
fn real_exports_honor_kitty_starship_and_zdotdir_destinations() {
    let sandbox = Sandbox::new();
    let kitty = sandbox.root.path().join("custom kitty ' directory");
    let starship = sandbox.root.path().join("prompt/custom.toml");
    let startup = sandbox.root.path().join("zsh startup ' directory");
    success(
        sandbox
            .configure(&["kitty", "starship", "zsh"])
            .env("KITTY_CONFIG_DIRECTORY", &kitty)
            .env("STARSHIP_CONFIG", &starship)
            .env("ZDOTDIR", &startup)
            .output()
            .unwrap(),
    );
    assert!(kitty.join("kitty.conf").is_file());
    assert!(kitty.join("generated/theme.conf").is_file());
    assert!(!kitty.join("kitty").exists());
    assert!(starship.is_file());
    assert!(startup.join(".zshrc").is_file());
    assert!(sandbox.config().join("luna-next/zsh/tools.zsh").is_file());
    assert!(!sandbox.config().join("kitty").exists());
    assert!(!sandbox.config().join("starship.toml").exists());
    assert!(!sandbox.root.path().join("home/.zshrc").exists());
}

#[test]
fn invalid_selected_themes_leave_installed_native_configs_intact() {
    let sandbox = Sandbox::new();
    let theme = sandbox.select_custom_theme();
    success(sandbox.configure(&["kitty", "starship"]).output().unwrap());
    let kitty = sandbox.config().join("kitty/generated/theme.conf");
    let starship = sandbox.config().join("starship.toml");
    let before_kitty = fs::read(&kitty).unwrap();
    let before_starship = fs::read(&starship).unwrap();
    write(&theme, "colors { accent = invalid }\n");
    for app in ["kitty", "starship"] {
        let output = sandbox.configure(&[app]).output().unwrap();
        assert!(!output.status.success(), "{output:?}");
        let response: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(response["ok"], false);
        assert!(
            response["error"]
                .as_str()
                .unwrap()
                .contains("Configuration command failed")
        );
    }
    assert_eq!(fs::read(kitty).unwrap(), before_kitty);
    assert_eq!(fs::read(starship).unwrap(), before_starship);
    assert_eq!(
        fs::read_to_string(theme).unwrap(),
        "colors { accent = invalid }\n"
    );
}
