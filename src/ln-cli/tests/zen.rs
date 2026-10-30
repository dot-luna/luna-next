use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
};

use serde_json::{Value, json};

struct Sandbox {
    root: tempfile::TempDir,
    repository: PathBuf,
}

impl Sandbox {
    fn new() -> Self {
        let root = tempfile::Builder::new()
            .prefix("luna zen's ")
            .tempdir()
            .unwrap();
        let repository = root.path().join("checkout");
        write(repository.join("Cargo.toml"), "[workspace]\nmembers = []\n");
        fs::create_dir_all(repository.join("src/ln-cli")).unwrap();
        write(
            repository.join("installs/packages.conf"),
            r#"{"core":[],"main":[{"name":"zen-browser-bin","source":"aur"}]}"#,
        );
        for file in [
            "packages.mise.conf",
            "packages.git.conf",
            "packages.local.conf",
            "packages.webapp.conf",
        ] {
            write(repository.join("installs").join(file), "[]");
        }
        copy_tree(
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/zen"),
            &repository.join("apps/zen"),
        );
        fs::create_dir_all(root.path().join("home")).unwrap();
        fs::create_dir(root.path().join("bin")).unwrap();
        write(root.path().join("provider-installed"), "");
        write(
            root.path().join("config/luna-next/theme.conf"),
            "theme.name = cli-test\n",
        );
        write(
            root.path()
                .join("home/.local/share/luna-next/themes/cli-test/theme.conf"),
            "colors.background = \"#123456\"\nfonts { ui = \"Zen CLI UI\", mono = \"Zen CLI Mono\" }\n",
        );
        let sandbox = Self { root, repository };
        sandbox.tool("pacman", "assert args == ['-Q', 'zen-browser-bin'], args\nif not (root / 'provider-installed').exists(): sys.exit(1)\nprint('zen-browser-bin 1.24b-1')\n");
        sandbox.tool("zen-browser", "assert args == ['--version'], 'configuration must never launch a browser'\nprint('Zen Browser 1.24b')\n");
        sandbox.tool("curl", r#"import io, zipfile
destination = pathlib.Path(args[args.index('--output') + 1])
extension_id = destination.name[:-4]
archive = io.BytesIO()
with zipfile.ZipFile(archive, 'w') as package:
    package.writestr('manifest.json', json.dumps({'manifest_version': 2, 'name': 'Fixture', 'version': '1.0', 'browser_specific_settings': {'gecko': {'id': extension_id}}}))
    for name in ['manifest.mf', 'mozilla.sf', 'mozilla.rsa']:
        package.writestr('META-INF/' + name, 'signature fixture; Zen verifies real signatures at startup')
destination.write_bytes(archive.getvalue())
"#);
        sandbox.tool("yay", "assert args == ['-S', '--aur', '--needed', '--noconfirm', '--', 'zen-browser-bin'], args\n(root / 'provider-installed').touch()\n");
        sandbox.tool(
            "systemctl",
            "assert args == ['--user', 'enable', '--now', 'gnome-keyring-daemon.socket'], args\n",
        );
        sandbox
    }

    fn profiles(&self) -> PathBuf {
        self.root.path().join("config/zen")
    }
    fn profile(&self) -> PathBuf {
        self.profiles().join("installation.default-release")
    }
    fn sibling(&self) -> PathBuf {
        self.profiles().join("other.default")
    }

    fn existing(&self) {
        write(
            self.profiles().join("profiles.ini"),
            "[InstallABC]\nDefault=installation.default-release\nLocked=1\n[Profile0]\nName=Other\nPath=other.default\nIsRelative=1\nDefault=1\n[Profile1]\nName=Installation\nPath=installation.default-release\nIsRelative=1\n",
        );
        write(
            self.profile().join("prefs.js"),
            "// browser-owned selected preferences\n",
        );
        write(self.profile().join("places.sqlite"), b"bookmarks\x00");
        write(self.sibling().join("prefs.js"), "// sibling preferences\n");
        write(self.sibling().join("user.js"), "// sibling appearance\n");
    }

    fn command(&self) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_luna"));
        command
            .env_clear()
            .env("HOME", self.root.path().join("home"))
            .env("XDG_CONFIG_HOME", self.root.path().join("config"))
            .env("PATH", self.root.path().join("bin"))
            .env("LUNA_ZEN_CLI_ROOT", self.root.path())
            .current_dir(&self.repository)
            .stdin(Stdio::null());
        command
    }

    fn run(&self, args: &[&str]) -> Output {
        self.command().args(args).output().unwrap()
    }

    fn tool(&self, name: &str, source: &str) {
        let path = self.root.path().join("bin").join(name);
        write(
            &path,
            format!(
                r#"#!/usr/bin/python3
import json, os, pathlib, sys
root = pathlib.Path(os.environ['LUNA_ZEN_CLI_ROOT'])
args = sys.argv[1:]
with (root / 'commands.jsonl').open('a') as log:
    log.write(json.dumps({{'tool': '{name}', 'args': args}}) + '\n')
{source}"#
            ),
        );
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    }

    fn calls(&self) -> Vec<Value> {
        fs::read_to_string(self.root.path().join("commands.jsonl"))
            .unwrap_or_default()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    fn assert_configured(&self, profile: &Path) {
        let prefs = fs::read_to_string(profile.join("user.js")).unwrap();
        assert!(prefs.contains("Zen CLI UI"), "{prefs}");
        assert!(prefs.contains("Zen CLI Mono"), "{prefs}");
        assert!(
            fs::read_to_string(profile.join("chrome/userChrome.css"))
                .unwrap()
                .contains("#123456")
        );
        let extensions: Vec<_> = fs::read_dir(profile.join("extensions")).unwrap().collect();
        assert_eq!(extensions.len(), 2);
        assert!(
            self.calls()
                .iter()
                .filter(|call| call["tool"] == "zen-browser")
                .all(|call| call["args"] == json!(["--version"]))
        );
    }
}

fn write(path: impl AsRef<Path>, bytes: impl AsRef<[u8]>) {
    let path = path.as_ref();
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, bytes).unwrap();
}

fn copy_tree(source: &Path, destination: &Path) {
    fs::create_dir_all(destination).unwrap();
    for entry in fs::read_dir(source).unwrap() {
        let entry = entry.unwrap();
        if entry.file_type().unwrap().is_dir() {
            copy_tree(&entry.path(), &destination.join(entry.file_name()));
        } else {
            fs::copy(entry.path(), destination.join(entry.file_name())).unwrap();
        }
    }
}

fn success(output: Output) -> Value {
    assert!(output.status.success(), "{output:?}");
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["ok"], true, "{value}");
    value["result"].clone()
}

fn error(output: Output) -> String {
    assert!(!output.status.success(), "{output:?}");
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["ok"], false, "{value}");
    value["error"].as_str().unwrap().into()
}

#[test]
fn implicit_configuration_skips_missing_zen_with_first_run_guidance() {
    let sandbox = Sandbox::new();
    let report = success(sandbox.run(&["conf", "--json"]));
    assert_eq!(report["installed"], json!([]));
    assert_eq!(
        report["skipped"],
        json!(["zen (open Zen once, then run luna conf zen)"])
    );
    assert!(!sandbox.profiles().exists());
    assert!(sandbox.calls().is_empty());
    let output = sandbox.run(&["conf"]);
    assert!(output.status.success(), "{output:?}");
    assert!(
        String::from_utf8(output.stdout)
            .unwrap()
            .contains("open Zen once")
    );
}

#[test]
fn explicit_configuration_requires_a_native_profile_without_creating_it() {
    let sandbox = Sandbox::new();
    let message = error(sandbox.run(&["conf", "zen", "--json"]));
    assert!(message.contains("open Zen once"), "{message}");
    assert!(!sandbox.profiles().exists());
    assert!(sandbox.calls().is_empty());
}

#[test]
fn configure_and_conf_select_the_installation_default_and_support_human_output() {
    for args in [
        vec!["configure", "zen", "--json"],
        vec!["--json", "conf", "zen"],
        vec!["conf", "zen"],
    ] {
        let sandbox = Sandbox::new();
        sandbox.existing();
        let registry = fs::read(sandbox.profiles().join("profiles.ini")).unwrap();
        let output = sandbox.run(&args);
        if args.contains(&"--json") {
            assert_eq!(success(output), json!({"installed":["zen"],"skipped":[]}));
        } else {
            assert!(output.status.success(), "{output:?}");
            let text = String::from_utf8(output.stdout).unwrap();
            assert!(text.contains("open Zen to apply"), "{text}");
        }
        sandbox.assert_configured(&sandbox.profile());
        assert_eq!(
            fs::read(sandbox.sibling().join("user.js")).unwrap(),
            b"// sibling appearance\n"
        );
        assert!(!sandbox.sibling().join("chrome").exists());
        assert_eq!(
            fs::read(sandbox.profiles().join("profiles.ini")).unwrap(),
            registry
        );
        assert_eq!(
            fs::read(sandbox.profile().join("places.sqlite")).unwrap(),
            b"bookmarks\x00"
        );
    }
}

#[test]
fn explicit_profile_override_configures_only_that_unregistered_directory() {
    let sandbox = Sandbox::new();
    sandbox.existing();
    let profile = sandbox.root.path().join("unregistered profile");
    write(profile.join("prefs.js"), "// independent native profile\n");
    let output = sandbox
        .command()
        .args(["conf", "zen", "--profile"])
        .arg(&profile)
        .arg("--json")
        .output()
        .unwrap();
    assert_eq!(success(output)["installed"], json!(["zen"]));
    sandbox.assert_configured(&profile);
    assert!(!sandbox.profile().join("user.js").exists());
    assert_eq!(
        fs::read(sandbox.sibling().join("user.js")).unwrap(),
        b"// sibling appearance\n"
    );
}

#[test]
fn package_install_infers_aur_and_configures_zen_without_starting_it() {
    let sandbox = Sandbox::new();
    sandbox.existing();
    fs::remove_file(sandbox.root.path().join("provider-installed")).unwrap();
    let report = success(sandbox.run(&["install", "zen-browser-bin", "--json"]));
    assert_eq!(
        report,
        json!({"installed":["zen-browser-bin","zen"],"skipped":[]})
    );
    assert_eq!(sandbox.calls()[0]["tool"], "yay");
    sandbox.assert_configured(&sandbox.profile());
}

#[test]
fn installing_zen_without_a_profile_leaves_native_first_run_to_the_user() {
    let sandbox = Sandbox::new();
    let report = success(sandbox.run(&["install", "zen-browser-bin", "--json"]));
    assert_eq!(report["installed"], json!(["zen-browser-bin"]));
    assert_eq!(
        report["skipped"],
        json!(["zen (open Zen once, then run luna conf zen)"])
    );
    assert_eq!(sandbox.calls().len(), 1);
    assert_eq!(sandbox.calls()[0]["tool"], "yay");
    assert!(!sandbox.profiles().exists());
}

#[test]
fn profile_flag_rejects_missing_mixed_or_unrelated_apps_before_execution() {
    let sandbox = Sandbox::new();
    for names in [
        vec![],
        vec!["zen", "chromium"],
        vec!["zen", "other"],
        vec!["other"],
    ] {
        let output = sandbox
            .command()
            .arg("conf")
            .args(names)
            .arg("--profile")
            .arg(sandbox.root.path().join("not-a-profile"))
            .arg("--json")
            .output()
            .unwrap();
        assert!(error(output).contains("--profile requires selecting only"));
    }
    assert!(sandbox.calls().is_empty());
    assert!(!sandbox.profiles().exists());
}

#[test]
fn setup_configures_existing_zen_and_enables_keyring_without_a_browser_launch() {
    let sandbox = Sandbox::new();
    sandbox.existing();
    let report = success(sandbox.run(&["setup", "--json"]));
    assert_eq!(
        report["installed"],
        json!(["zen-browser-bin", "zen", "GNOME Keyring socket"])
    );
    assert_eq!(report["skipped"], json!([]));
    sandbox.assert_configured(&sandbox.profile());
    assert_eq!(sandbox.calls().last().unwrap()["tool"], "systemctl");
}
