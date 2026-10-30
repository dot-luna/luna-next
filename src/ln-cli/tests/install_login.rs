use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use serde_json::{Value, json};

struct Fixture {
    root: tempfile::TempDir,
    repository: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let repository = root.path().join("repository");
        let checkout = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        // Exercise the real recipes in an isolated copy: a bad runtime destination
        // must not allow a screen installation to write into the working checkout.
        for folder in ["installs", "apps/luna-login", "src/luna-login/src"] {
            copy_directory(&checkout.join(folder), &repository.join(folder));
        }
        Self { root, repository }
    }

    fn command(&self) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_luna"));
        command
            .env_clear()
            .env("HOME", self.root.path())
            .env("XDG_CONFIG_HOME", self.root.path().join("config"))
            .env("PATH", "")
            .current_dir(self.root.path());
        command
    }

    fn success(&self, command: &mut Command) -> Value {
        let output = command.output().unwrap();
        assert!(output.status.success(), "{output:?}");
        assert!(output.stderr.is_empty(), "{output:?}");
        let response: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(response["ok"], true, "{response}");
        response["result"].clone()
    }

    fn install(&self) -> Value {
        self.success(
            self.command()
                .args(["install", "--local", "login", "--json", "--repo"])
                .arg(&self.repository),
        )
    }

    fn config(&self) -> PathBuf {
        self.root.path().join("config/luna-next/login.conf")
    }

    fn defaults(&self) -> PathBuf {
        self.root
            .path()
            .join("config/luna-next/defaults/login.conf")
    }

    fn runtime(&self) -> PathBuf {
        self.root.path().join(".local/share/luna-next/login/app")
    }

    fn screens(&self) -> PathBuf {
        self.root
            .path()
            .join(".local/share/luna-next/login/screens")
    }
}

fn copy_directory(source: &Path, destination: &Path) {
    fs::create_dir_all(destination).unwrap();
    for entry in fs::read_dir(source).unwrap() {
        let entry = entry.unwrap();
        let target = destination.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_directory(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

fn snapshot(root: &Path) -> BTreeMap<PathBuf, Option<Vec<u8>>> {
    fn collect(root: &Path, path: &Path, entries: &mut BTreeMap<PathBuf, Option<Vec<u8>>>) {
        for entry in fs::read_dir(path).unwrap() {
            let entry = entry.unwrap();
            let path = entry.path();
            let relative = path.strip_prefix(root).unwrap().to_path_buf();
            if entry.file_type().unwrap().is_dir() {
                entries.insert(relative, None);
                collect(root, &path, entries);
            } else {
                entries.insert(relative, Some(fs::read(path).unwrap()));
            }
        }
    }
    let mut entries = BTreeMap::new();
    collect(root, root, &mut entries);
    entries
}

#[test]
fn login_install_links_runtime_and_exports_managed_defaults_without_system_commands() {
    let fixture = Fixture::new();
    let original = snapshot(&fixture.repository);
    let result = fixture.install();
    assert_eq!(result["installed"], json!(["login", "luna-login"]));
    let runtime = fixture.runtime();
    assert!(fs::symlink_metadata(&runtime).unwrap().is_symlink());
    assert_eq!(
        fs::canonicalize(&runtime).unwrap(),
        fixture.repository.join("src/luna-login/src")
    );
    assert!(runtime.join("greeter/Main.qml").is_file());
    assert!(runtime.join("screens/default/Screen.qml").is_file());
    assert!(runtime.join("config.schema.json").is_file());
    assert_eq!(
        fs::read_to_string(fixture.config()).unwrap(),
        format!(
            "include required(file({}))\n",
            serde_json::to_string(&fixture.defaults()).unwrap()
        )
    );
    assert_eq!(
        fs::read(fixture.defaults()).unwrap(),
        fs::read(fixture.repository.join("apps/luna-login/config/login.conf")).unwrap()
    );
    let config = fixture.success(fixture.command().args(["login", "get-config", "--json"]));
    assert_eq!(config["screen"]["name"], "default");
    assert_eq!(config["wallpaper"]["type"], "auto");
    assert_eq!(config["wallpaper"]["source"], "");
    assert_eq!(config["colors"], json!({}));
    assert_eq!(config["fonts"], json!({}));
    assert!(!fixture.root.path().join("config/systemd").exists());
    assert!(!fixture.root.path().join(".local/bin").exists());
    assert_eq!(snapshot(&fixture.repository), original);
}

#[test]
fn custom_screens_use_a_sibling_library_and_survive_runtime_reinstallation() {
    let fixture = Fixture::new();
    let original = snapshot(&fixture.repository);
    fixture.install();
    let source = fixture.root.path().join("custom-screen");
    fs::create_dir(&source).unwrap();
    let qml =
        "import QtQuick\nItem { required property var settings; required property var login }\n";
    fs::write(source.join("Screen.qml"), qml).unwrap();
    let installed = fixture.success(
        fixture
            .command()
            .args(["login", "install", "--name", "custom", "--json"])
            .arg(&source),
    );
    let library = fixture.screens();
    assert_eq!(installed, json!(library.join("custom")));
    assert!(library.is_dir());
    assert!(!fs::symlink_metadata(&library).unwrap().is_symlink());
    assert_eq!(
        fs::read_to_string(library.join("custom/Screen.qml")).unwrap(),
        qml
    );
    assert!(!fixture.runtime().join("screens/custom").exists());
    let selected = fixture.success(fixture.command().args(["login", "set", "custom", "--json"]));
    assert_eq!(selected["screen"]["name"], "custom");
    assert!(
        fs::read_to_string(fixture.config())
            .unwrap()
            .contains("include required(file("),
    );
    let listed = fixture.success(fixture.command().args(["login", "list", "--json"]));
    assert!(
        listed
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| { entry["name"] == "custom" && entry["current"] == true })
    );
    fs::write(fixture.defaults(), "screen.name = changed-default\n").unwrap();
    fixture.install();
    let current = fixture.success(fixture.command().args(["login", "current", "--json"]));
    assert_eq!(current, "default");
    assert_eq!(
        fs::read_to_string(library.join("custom/Screen.qml")).unwrap(),
        qml
    );
    assert_eq!(
        fs::read(fixture.defaults()).unwrap(),
        fs::read(fixture.repository.join("apps/luna-login/config/login.conf")).unwrap()
    );
    assert_eq!(snapshot(&fixture.repository), original);
}
