use std::{
    collections::BTreeMap,
    fs,
    os::unix::{
        ffi::{OsStrExt, OsStringExt},
        fs::PermissionsExt,
    },
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
};

use serde_json::{Value, json};
use tempfile::TempDir;

const EXTENSIONS: [&str; 4] = [
    "epcnnfbjfcgphgdmggkamkmgojdagdnn",
    "mnjggcdmjocbbbhaepdhchncahnbgone",
    "kmfcinojnfabkpndlgomnfjllgeppegb",
    "cmedhionkhpnakcndndgjdbohmhepckk",
];

struct Sandbox {
    root: TempDir,
    repository: PathBuf,
}

impl Sandbox {
    fn new() -> Self {
        let root = tempfile::Builder::new()
            .prefix("luna chromium's ")
            .tempdir()
            .unwrap();
        let repository = root.path().join("checkout");
        write(repository.join("Cargo.toml"), "[workspace]\nmembers = []\n");
        fs::create_dir_all(repository.join("src/ln-cli")).unwrap();
        write_json(
            repository.join("installs/packages.conf"),
            json!({
                "core": [], "main": [{"name": "ungoogled-chromium-bin", "source": "aur"}]
            }),
        );
        for file in [
            "packages.mise.conf",
            "packages.git.conf",
            "packages.local.conf",
            "packages.webapp.conf",
        ] {
            write_json(repository.join("installs").join(file), json!([]));
        }
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/chromium");
        copy_tree(&source, &repository.join("apps/chromium"));
        fs::create_dir_all(root.path().join("home")).unwrap();
        fs::create_dir(root.path().join("bin")).unwrap();
        write(root.path().join("provider-installed"), "");
        write_json(
            root.path().join("config/chromium/Default/Preferences"),
            json!({
                "profile": {"name": "Existing Chromium"}, "keep": true
            }),
        );
        write(
            root.path().join("config/chromium/Default/Bookmarks"),
            "normal bookmarks",
        );
        write(
            root.path().join("config/chromium/Default/Network/Cookies"),
            b"normal cookies\x00",
        );
        write(
            root.path().join("config/chromium/Local State"),
            "{\"profile\":{\"last_used\":\"Default\"},\"keep\":true}\n",
        );
        write(
            root.path().join("config/luna-next/theme.conf"),
            "theme.name = cli-test\n",
        );
        write(
            root.path()
                .join("home/.local/share/luna-next/themes/cli-test/theme.conf"),
            "colors { dark_background = \"#123456\", background = \"#abcdef\" }\nfonts { ui = \"CLI UI\", mono = \"CLI Mono\" }\n",
        );
        let sandbox = Self { root, repository };
        sandbox.tool(
            "git",
            r#"assert args == ['config', '--global', '--get', 'user.name'], args
if os.environ.get('CHROMIUM_TEST_MISSING_GIT'):
    sys.exit(1)
print(os.environ.get('CHROMIUM_TEST_GIT_NAME', 'Luna Test'))
"#,
        );
        sandbox.tool(
            "pacman",
            r#"assert args == ['-Q', 'ungoogled-chromium-bin'], args
if not (root / 'provider-installed').exists():
    sys.exit(1)
print('ungoogled-chromium-bin 156.0.8078.73-1')
"#,
        );
        sandbox.tool("chromium", r#"import hashlib, io, struct, urllib.parse, zipfile
pack = next((argument.split('=', 1)[1] for argument in args if argument.startswith('--pack-extension=')), None)
if args == ['--version']:
    print('unrecognized browser' if os.environ.get('CHROMIUM_TEST_BAD_VERSION') else 'Chromium 156.0.8078.73')
elif pack:
    source = pathlib.Path(pack)
    manifest = json.loads((source / 'manifest.json').read_text())
    key_path = next((argument.split('=', 1)[1] for argument in args if argument.startswith('--pack-extension-key=')), None)
    if key_path:
        key = pathlib.Path(key_path).read_bytes()
    else:
        key = ('fixture key for ' + source.name).encode()
        pathlib.Path(str(source) + '.pem').write_bytes(key)
    def varint(value):
        encoded = bytearray()
        while value > 127:
            encoded.append((value & 127) | 128)
            value >>= 7
        encoded.append(value)
        return bytes(encoded)
    signed = b'\x0a\x10' + hashlib.sha256(key).digest()[:16]
    header = varint((10000 << 3) | 2) + varint(len(signed)) + signed
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, 'w') as package:
        for file in source.rglob('*'):
            if file.is_file():
                package.write(file, file.relative_to(source))
    pathlib.Path(str(source) + '.crx').write_bytes(b'Cr24' + struct.pack('<II', 3, len(header)) + header + archive.getvalue())
    with (root / 'packing.jsonl').open('a') as log:
        log.write(json.dumps({'manifest': manifest, 'css': (source / 'style.css').read_text() if (source / 'style.css').exists() else None}) + '\n')
else:
    print('fixture browser diagnostics', file=sys.stderr)
    if os.environ.get('CHROMIUM_TEST_OPEN_FAIL'):
        sys.exit(17)
    page = next((argument for argument in args if argument.startswith('file://')), None)
    if page:
        path = pathlib.Path(os.fsdecode(urllib.parse.unquote_to_bytes(urllib.parse.urlparse(page).path)))
        assert path.is_file(), path
        assert (path.parent / 'theme.crx').is_file()
        assert (path.parent / 'websites.crx').is_file()
        assert len(list((path.parent / 'extensions').glob('*.crx'))) == 4
        preferences = json.loads((path.parent.parent / 'Preferences').read_text())
        assert preferences['webkit']['webprefs']['fonts']['fixed']['Zyyy'] == 'CLI Mono'
    (root / 'launched.json').write_text(json.dumps(args))
    (root / 'launched-args-hex.json').write_text(json.dumps([os.fsencode(arg).hex() for arg in args]))
"#);
        sandbox.tool("curl", r#"import base64, io, struct, zipfile
destination = pathlib.Path(args[args.index('--output') + 1])
url = args[args.index('--url') + 1]
if os.environ.get('CHROMIUM_TEST_DOWNLOAD_FAIL', '!') in url:
    print('fixture download failed', file=sys.stderr)
    sys.exit(23)
if url.startswith('https://clients2.google.com/service/update2/crx?'):
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, 'w') as package:
        package.writestr('manifest.json', json.dumps({'manifest_version': 3, 'name': 'Fixture', 'version': '1.2.3'}))
    # Chromium verifies real package signatures when the user accepts each install.
    destination.write_bytes(b'Cr24' + struct.pack('<II', 3, 2) + b'\x0a\x00' + archive.getvalue())
else:
    assert args[args.index('--write-out') + 1] == '%{url_effective}', args
    if url.endswith('.png'):
        data = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')
    else:
        data = b'<html><head><link rel="icon" href="/site-icon.png"></head></html>'
    destination.write_bytes(data)
    sys.stdout.write(url)
"#);
        sandbox.tool(
            "file",
            r#"assert args[:3] == ['--brief', '--mime-type', '--'], args
assert pathlib.Path(args[3]).is_file()
print('image/png')
"#,
        );
        sandbox.tool(
            "systemctl",
            r#"assert args == ['--user', 'enable', '--now', 'gnome-keyring-daemon.socket'], args
if os.environ.get('CHROMIUM_TEST_KEYRING_FAIL'):
    sys.exit(17)
"#,
        );
        sandbox.tool(
            "yay",
            r#"print('fixture yay progress')
if os.environ.get('CHROMIUM_TEST_INSTALL_FAIL'):
    sys.exit(17)
(root / 'provider-installed').touch()
"#,
        );
        sandbox
    }

    fn command(&self) -> Command {
        self.command_at(Path::new(env!("CARGO_BIN_EXE_luna")))
    }

    fn command_at(&self, executable: &Path) -> Command {
        let mut command = Command::new(executable);
        command
            .env_clear()
            .env("HOME", self.root.path().join("home"))
            .env("XDG_CONFIG_HOME", self.root.path().join("config"))
            .env("PATH", self.root.path().join("bin"))
            .env("CHROMIUM_TEST_ROOT", self.root.path())
            .current_dir(&self.repository)
            .stdin(Stdio::null());
        command
    }

    fn run(&self, args: &[&str]) -> Output {
        self.command().args(args).output().unwrap()
    }

    fn success(&self, args: &[&str]) -> Value {
        success(self.run(args))
    }

    fn create(&self) {
        let profile = self.success(&["chromium", "create-profile", "--json"]);
        assert_eq!(profile["directory"], json!(self.profile()));
        assert_eq!(profile["name"], "Luna Test");
        assert_eq!(profile["launcher"], json!(self.launcher()));
    }

    fn managed(&self) -> PathBuf {
        self.root.path().join("config/luna-next/chromium")
    }

    fn profile(&self) -> PathBuf {
        self.managed().join("Default")
    }

    fn launcher(&self) -> PathBuf {
        self.root.path().join("home/.local/bin/luna-chromium")
    }

    fn normal(&self) -> PathBuf {
        self.root.path().join("config/chromium")
    }

    fn calls(&self) -> Vec<Value> {
        json_lines(&self.root.path().join("commands.jsonl"))
    }

    fn youtube_catalog(&self) {
        write_json(
            self.repository.join("installs/packages.webapp.conf"),
            json!([{"name": "YouTube", "url": "https://www.youtube.com/"}]),
        );
    }

    fn webapp_entries(&self) -> Vec<PathBuf> {
        let applications = self.root.path().join("home/.local/share/applications");
        if !applications.exists() {
            return Vec::new();
        }
        fs::read_dir(applications)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| {
                path.file_name()
                    .unwrap()
                    .to_str()
                    .unwrap()
                    .starts_with("luna-webapp-")
                    && path
                        .extension()
                        .is_some_and(|extension| extension == "desktop")
            })
            .collect()
    }

    fn tool(&self, name: &str, source: &str) {
        let path = self.root.path().join("bin").join(name);
        write(
            &path,
            format!(
                r#"#!/usr/bin/python3
import json, os, pathlib, sys
root = pathlib.Path(os.environ['CHROMIUM_TEST_ROOT'])
args = sys.argv[1:]
with (root / 'commands.jsonl').open('a') as log:
    log.write(json.dumps({{'tool': '{name}', 'args': args}}) + '\n')
{source}"#
            ),
        );
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    }

    fn assert_fonts_and_bundle(&self, profile: &Path, name: &str) {
        let preferences = read_json(profile.join("Preferences"));
        assert_eq!(preferences["profile"]["name"], name);
        let fonts = &preferences["webkit"]["webprefs"]["fonts"];
        for family in ["standard", "sansserif", "serif"] {
            assert_eq!(fonts[family]["Zyyy"], "CLI UI");
        }
        assert_eq!(fonts["fixed"]["Zyyy"], "CLI Mono");
        let bundle = profile.join("Luna Next");
        for id in EXTENSIONS {
            assert!(
                fs::read(bundle.join("extensions").join(format!("{id}.crx")))
                    .unwrap()
                    .starts_with(b"Cr24")
            );
        }
        for name in ["theme", "websites"] {
            assert!(
                fs::read(bundle.join(format!("{name}.crx")))
                    .unwrap()
                    .starts_with(b"Cr24")
            );
            assert!(
                !fs::read(bundle.join("keys").join(format!("{name}.pem")))
                    .unwrap()
                    .is_empty()
            );
        }
        let page = fs::read_to_string(bundle.join("install.html")).unwrap();
        for filename in [
            "theme.crx",
            "websites.crx",
            EXTENSIONS[0],
            EXTENSIONS[1],
            EXTENSIONS[2],
            EXTENSIONS[3],
        ] {
            assert!(page.contains(filename), "missing {filename} in {page}");
        }
        let packed = json_lines(&self.root.path().join("packing.jsonl"));
        assert!(
            packed
                .iter()
                .any(|value| value["manifest"]["theme"]["colors"]["frame"] == json!([18, 52, 86]))
        );
        assert!(
            packed.iter().any(|value| value["css"]
                .as_str()
                .is_some_and(|css| css.contains("border-radius: 0 !important")
                    && css.contains("CLI UI")
                    && css.contains("CLI Mono")))
        );
    }

    fn assert_installation_launch(&self, profile: &Path) {
        let args = read_json(self.root.path().join("launched.json"));
        let args = args.as_array().unwrap();
        assert!(args.contains(&json!(format!(
            "--user-data-dir={}",
            profile.parent().unwrap().display()
        ))));
        assert!(args.contains(&json!(format!(
            "--profile-directory={}",
            profile.file_name().unwrap().to_str().unwrap()
        ))));
        assert!(args.contains(&json!(
            "--extension-mime-request-handling=always-prompt-for-install"
        )));
        assert!(args.iter().any(|arg| {
            arg.as_str()
                .is_some_and(|arg| arg.starts_with("file://") && arg.ends_with("/install.html"))
        }));
        assert!(
            args.iter()
                .all(|arg| !arg.as_str().unwrap().starts_with("--load-extension")
                    && !arg.as_str().unwrap().starts_with("--remote-debugging"))
        );
    }
}

fn write(path: impl AsRef<Path>, source: impl AsRef<[u8]>) {
    let path = path.as_ref();
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, source).unwrap();
}

fn write_json(path: impl AsRef<Path>, value: Value) {
    write(path, serde_json::to_vec_pretty(&value).unwrap());
}

fn read_json(path: impl AsRef<Path>) -> Value {
    serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
}

fn json_lines(path: &Path) -> Vec<Value> {
    fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

fn copy_tree(source: &Path, target: &Path) {
    fs::create_dir_all(target).unwrap();
    for entry in fs::read_dir(source).unwrap() {
        let entry = entry.unwrap();
        let destination = target.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_tree(&entry.path(), &destination);
        } else {
            fs::copy(entry.path(), destination).unwrap();
        }
    }
}

fn snapshot(directory: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    fn collect(directory: &Path, relative: &Path, files: &mut BTreeMap<PathBuf, Vec<u8>>) {
        for entry in fs::read_dir(directory.join(relative)).unwrap() {
            let entry = entry.unwrap();
            let path = relative.join(entry.file_name());
            if entry.file_type().unwrap().is_dir() {
                collect(directory, &path, files);
            } else {
                files.insert(path, fs::read(entry.path()).unwrap());
            }
        }
    }
    let mut files = BTreeMap::new();
    collect(directory, Path::new(""), &mut files);
    files
}

fn success(output: Output) -> Value {
    assert!(output.status.success(), "{output:?}");
    let response: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["ok"], true, "{response}");
    response["result"].clone()
}

fn error(output: Output) -> String {
    assert!(!output.status.success(), "{output:?}");
    let response: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["ok"], false, "{response}");
    response["error"].as_str().unwrap().to_owned()
}

#[test]
fn create_profile_is_separate_from_configuration_and_preserves_existing_profiles() {
    let sandbox = Sandbox::new();
    let normal = snapshot(&sandbox.normal());
    sandbox.create();
    let preferences = read_json(sandbox.profile().join("Preferences"));
    assert_eq!(
        preferences,
        json!({"profile": {"name": "Luna Test", "using_default_name": false}})
    );
    assert_eq!(
        fs::read(sandbox.managed().join(".luna-managed")).unwrap(),
        b"Luna Next Chromium\n"
    );
    assert_ne!(
        fs::metadata(sandbox.launcher())
            .unwrap()
            .permissions()
            .mode()
            & 0o111,
        0
    );
    assert!(!sandbox.profile().join("Luna Next").exists());
    assert!(sandbox.calls().iter().all(|call| call["tool"] != "curl"));
    assert!(!sandbox.root.path().join("launched.json").exists());
    let original = snapshot(&sandbox.profile());
    let output = sandbox
        .command()
        .env("CHROMIUM_TEST_MISSING_GIT", "1")
        .args(["chromium", "create-profile", "--json"])
        .output()
        .unwrap();
    assert_eq!(success(output)["name"], "Luna Test");
    assert_eq!(snapshot(&sandbox.profile()), original);
    assert_eq!(snapshot(&sandbox.normal()), normal);
}

#[test]
fn conf_requires_an_existing_profile_and_profile_override_requires_only_chromium() {
    let sandbox = Sandbox::new();
    let message = error(sandbox.run(&["conf", "chromium", "--json"]));
    assert!(message.contains("create-profile"), "{message}");
    let missing = sandbox.root.path().join("not-created/Profile 1");
    let output = sandbox
        .command()
        .args(["conf", "chromium", "--profile"])
        .arg(&missing)
        .arg("--json")
        .output()
        .unwrap();
    assert!(error(output).contains("does not exist"));
    for names in [vec![], vec!["other"], vec!["chromium", "other"]] {
        let output = sandbox
            .command()
            .arg("conf")
            .args(names)
            .arg("--profile")
            .arg(&missing)
            .arg("--json")
            .output()
            .unwrap();
        assert!(error(output).contains("only the chromium"));
    }
    assert!(!sandbox.managed().exists());
    assert!(!missing.exists());
    assert!(sandbox.calls().is_empty());
}

#[test]
fn configure_and_conf_apply_the_existing_profile_with_json_or_human_output() {
    for arguments in [
        vec!["configure", "chromium", "--json"],
        vec!["--json", "conf", "chromium"],
        vec!["conf", "chromium"],
    ] {
        let sandbox = Sandbox::new();
        sandbox.create();
        let normal = snapshot(&sandbox.normal());
        let output = sandbox.run(&arguments);
        assert!(output.status.success(), "{output:?}");
        if arguments.contains(&"--json") {
            let response: Value = serde_json::from_slice(&output.stdout).unwrap();
            assert_eq!(
                response,
                json!({"ok": true, "result": {"installed": ["chromium"], "skipped": []}})
            );
        } else {
            let output = String::from_utf8(output.stdout).unwrap();
            assert!(output.contains("Chromium"), "{output}");
            assert!(!output.contains("Installed: chromium"), "{output}");
        }
        sandbox.assert_fonts_and_bundle(&sandbox.profile(), "Luna Test");
        sandbox.assert_installation_launch(&sandbox.profile());
        assert_eq!(snapshot(&sandbox.normal()), normal);
        assert_eq!(
            sandbox
                .calls()
                .iter()
                .filter(|call| call["tool"] == "curl")
                .count(),
            EXTENSIONS.len()
        );
    }
}

#[test]
fn setup_creates_once_and_preserves_the_profiles_name_data_and_signing_keys_on_reapply() {
    let sandbox = Sandbox::new();
    let normal = snapshot(&sandbox.normal());
    let output = sandbox.run(&["chromium", "setup", "--json"]);
    assert!(output.stderr.is_empty(), "{output:?}");
    let result = success(output);
    assert!(
        fs::read_to_string(sandbox.profile().join("Luna Next/browser.log"))
            .unwrap()
            .contains("fixture browser diagnostics")
    );
    assert_eq!(result["profile"], json!(sandbox.profile()));
    assert_eq!(result["profile_name"], "Luna Test");
    assert_eq!(result["extensions"], json!(EXTENSIONS));
    assert_eq!(
        result["installation_page"],
        json!(sandbox.profile().join("Luna Next/install.html"))
    );
    assert_eq!(result["installation_requires_confirmation"], true);
    sandbox.assert_installation_launch(&sandbox.profile());
    let mut preferences = read_json(sandbox.profile().join("Preferences"));
    preferences["profile"]["name"] = json!("Hand Renamed");
    preferences["bookmark_bar"] = json!({"show_on_all_tabs": true});
    preferences["browser"] = json!({"custom_chrome_frame": true});
    write_json(sandbox.profile().join("Preferences"), preferences);
    write(sandbox.profile().join("Bookmarks"), "managed bookmarks");
    write(
        sandbox.profile().join("Network/Cookies"),
        b"managed cookies\x00",
    );
    let keys = snapshot(&sandbox.profile().join("Luna Next/keys"));
    let output = sandbox
        .command()
        .env("CHROMIUM_TEST_MISSING_GIT", "1")
        .args(["chromium", "setup", "--json"])
        .output()
        .unwrap();
    assert_eq!(success(output)["profile_name"], "Hand Renamed");
    sandbox.assert_fonts_and_bundle(&sandbox.profile(), "Hand Renamed");
    assert_eq!(
        read_json(sandbox.profile().join("Preferences"))["bookmark_bar"]["show_on_all_tabs"],
        true
    );
    assert_eq!(
        read_json(sandbox.profile().join("Preferences"))["browser"]["custom_chrome_frame"],
        true
    );
    assert_eq!(
        fs::read(sandbox.profile().join("Bookmarks")).unwrap(),
        b"managed bookmarks"
    );
    assert_eq!(
        fs::read(sandbox.profile().join("Network/Cookies")).unwrap(),
        b"managed cookies\x00"
    );
    assert_eq!(snapshot(&sandbox.profile().join("Luna Next/keys")), keys);
    assert_eq!(snapshot(&sandbox.normal()), normal);
}

#[test]
fn explicit_profile_in_a_shared_root_leaves_default_and_the_default_launcher_untouched() {
    let sandbox = Sandbox::new();
    sandbox.create();
    let managed_default = snapshot(&sandbox.profile());
    let launcher = fs::read(sandbox.launcher()).unwrap();
    let default = snapshot(&sandbox.normal().join("Default"));
    let state = fs::read(sandbox.normal().join("Local State")).unwrap();
    let selected = sandbox.normal().join("Profile 1");
    write_json(
        selected.join("Preferences"),
        json!({
            "profile": {"name": "Work", "using_default_name": true},
            "browser": {"custom_chrome_frame": true},
            "webkit": {"webprefs": {"fonts": {"standard": {"Cyrl": "Keep Cyrillic"}, "fixed": {"Arab": "Keep Arabic"}}}},
            "keep": [1, 2, 3]
        }),
    );
    write(selected.join("Bookmarks"), "work bookmarks");
    write(selected.join("Network/Cookies"), b"work cookies\x00");
    let output = sandbox
        .command()
        .env("CHROMIUM_TEST_MISSING_GIT", "1")
        .args(["conf", "chromium", "--profile"])
        .arg(&selected)
        .arg("--json")
        .output()
        .unwrap();
    assert_eq!(success(output)["installed"], json!(["chromium"]));
    sandbox.assert_fonts_and_bundle(&selected, "Work");
    sandbox.assert_installation_launch(&selected);
    let preferences = read_json(selected.join("Preferences"));
    assert_eq!(preferences["profile"]["using_default_name"], true);
    assert_eq!(preferences["browser"]["custom_chrome_frame"], true);
    assert_eq!(
        preferences["webkit"]["webprefs"]["fonts"]["standard"]["Cyrl"],
        "Keep Cyrillic"
    );
    assert_eq!(
        preferences["webkit"]["webprefs"]["fonts"]["fixed"]["Arab"],
        "Keep Arabic"
    );
    assert_eq!(preferences["keep"], json!([1, 2, 3]));
    assert_eq!(
        fs::read(selected.join("Bookmarks")).unwrap(),
        b"work bookmarks"
    );
    assert_eq!(
        fs::read(selected.join("Network/Cookies")).unwrap(),
        b"work cookies\x00"
    );
    assert_eq!(snapshot(&sandbox.normal().join("Default")), default);
    assert_eq!(
        fs::read(sandbox.normal().join("Local State")).unwrap(),
        state
    );
    assert_eq!(snapshot(&sandbox.profile()), managed_default);
    assert_eq!(fs::read(sandbox.launcher()).unwrap(), launcher);
}

#[test]
fn configuration_launch_preserves_non_utf8_parent_directories() {
    let sandbox = Sandbox::new();
    let browser_root = sandbox
        .root
        .path()
        .join(std::ffi::OsString::from_vec(b"browser-\xff".to_vec()));
    let selected = browser_root.join("Profile 1");
    write_json(
        selected.join("Preferences"),
        json!({"profile": {"name": "Work"}}),
    );
    let output = sandbox
        .command()
        .args(["conf", "chromium", "--profile"])
        .arg(&selected)
        .arg("--json")
        .output()
        .unwrap();
    assert!(output.stderr.is_empty(), "{output:?}");
    success(output);
    let mut expected = b"--user-data-dir=".to_vec();
    expected.extend_from_slice(browser_root.as_os_str().as_bytes());
    let expected: String = expected.iter().map(|byte| format!("{byte:02x}")).collect();
    let arguments = read_json(sandbox.root.path().join("launched-args-hex.json"));
    assert!(arguments.as_array().unwrap().contains(&json!(expected)));
}

#[test]
fn setup_reports_browser_launch_failure_with_a_private_log_and_keeps_prepared_files() {
    let sandbox = Sandbox::new();
    let output = sandbox
        .command()
        .env("CHROMIUM_TEST_OPEN_FAIL", "1")
        .args(["chromium", "setup", "--json"])
        .output()
        .unwrap();
    assert!(output.stderr.is_empty(), "{output:?}");
    let message = error(output);
    let log = sandbox.profile().join("Luna Next/browser.log");
    assert!(message.contains("could not open"), "{message}");
    assert!(message.contains(log.to_str().unwrap()), "{message}");
    assert_eq!(
        fs::metadata(&log).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert!(
        fs::read_to_string(log)
            .unwrap()
            .contains("fixture browser diagnostics")
    );
    sandbox.assert_fonts_and_bundle(&sandbox.profile(), "Luna Test");
    assert!(!sandbox.root.path().join("launched.json").exists());
}

#[test]
fn launcher_uses_the_default_profile_and_preserves_arguments_with_spaces() {
    let sandbox = Sandbox::new();
    sandbox.create();
    let output = Command::new(sandbox.launcher())
        .env_clear()
        .env("CHROMIUM_TEST_ROOT", sandbox.root.path())
        .args([
            "--new-window",
            "https://example.invalid/search?q=with spaces",
        ])
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    let args = read_json(sandbox.root.path().join("launched.json"));
    let args = args.as_array().unwrap();
    assert!(args.contains(&json!(format!(
        "--user-data-dir={}",
        sandbox.managed().display()
    ))));
    assert!(args.contains(&json!("--profile-directory=Default")));
    assert_eq!(
        &args[args.len() - 2..],
        &[
            json!("--new-window"),
            json!("https://example.invalid/search?q=with spaces")
        ]
    );
}

#[test]
fn implicit_package_configuration_skips_missing_profiles_and_prepares_existing_ones() {
    for existing in [false, true] {
        let sandbox = Sandbox::new();
        if existing {
            sandbox.create();
        }
        let before = sandbox.calls().len();
        fs::remove_file(sandbox.root.path().join("provider-installed")).unwrap();
        let output = sandbox.run(&["install", "ungoogled-chromium-bin", "--json"]);
        assert!(String::from_utf8_lossy(&output.stderr).contains("fixture yay progress"));
        let result = success(output);
        let calls = sandbox.calls();
        assert_eq!(calls[before]["tool"], "yay");
        assert!(!sandbox.root.path().join("launched.json").exists());
        if existing {
            assert_eq!(
                result["installed"],
                json!(["ungoogled-chromium-bin", "chromium"])
            );
            assert_eq!(result["skipped"], json!([]));
            sandbox.assert_fonts_and_bundle(&sandbox.profile(), "Luna Test");
        } else {
            assert_eq!(result["installed"], json!(["ungoogled-chromium-bin"]));
            assert_eq!(
                result["skipped"],
                json!(["chromium (run luna chromium setup)"])
            );
            assert_eq!(calls.len(), before + 1);
            assert!(!sandbox.managed().exists());
            assert!(!sandbox.launcher().exists());
        }
    }
}

#[test]
fn full_setup_configures_the_default_before_installing_webapps_after_keyring_and_reuses_it() {
    let sandbox = Sandbox::new();
    sandbox.youtube_catalog();
    let normal = snapshot(&sandbox.normal());
    let result = sandbox.success(&["setup", "--json"]);
    assert_eq!(
        result["installed"],
        json!([
            "ungoogled-chromium-bin",
            "chromium",
            "GNOME Keyring socket",
            "YouTube"
        ])
    );
    sandbox.assert_fonts_and_bundle(&sandbox.profile(), "Luna Test");
    assert!(!sandbox.root.path().join("launched.json").exists());
    let calls = sandbox.calls();
    assert_eq!(calls[0]["tool"], "yay");
    let created = calls.iter().position(|call| call["tool"] == "git").unwrap();
    let keyring = calls
        .iter()
        .position(|call| call["tool"] == "systemctl")
        .unwrap();
    let downloads: Vec<_> = calls
        .iter()
        .enumerate()
        .filter_map(|(index, call)| {
            (call["tool"] == "curl").then(|| {
                let args = call["args"].as_array().unwrap();
                let url = args
                    .iter()
                    .position(|argument| argument == "--url")
                    .unwrap();
                (index, args[url + 1].as_str().unwrap())
            })
        })
        .collect();
    assert_eq!(downloads.len(), EXTENSIONS.len() + 2);
    assert!(created < downloads[0].0);
    assert!(downloads[EXTENSIONS.len() - 1].0 < keyring);
    assert_eq!(downloads[EXTENSIONS.len()].1, "https://www.youtube.com/");
    assert!(keyring < downloads[EXTENSIONS.len()].0);
    assert_eq!(
        downloads.last().unwrap().1,
        "https://www.youtube.com/site-icon.png"
    );
    let entries = sandbox.webapp_entries();
    assert_eq!(entries.len(), 1);
    let entry = fs::read_to_string(&entries[0]).unwrap();
    assert!(entry.contains("Name=YouTube\n"), "{entry}");
    assert!(
        entry.contains("webapp launch \"https://www.youtube.com/\""),
        "{entry}"
    );
    assert!(!entry.contains(" --profile "), "{entry}");
    let assets = sandbox
        .root
        .path()
        .join("home/.local/share/luna-next/webapps");
    assert_eq!(fs::read_dir(&assets).unwrap().count(), 1);
    let keys = snapshot(&sandbox.profile().join("Luna Next/keys"));
    let mut preferences = read_json(sandbox.profile().join("Preferences"));
    preferences["profile"]["name"] = json!("Personal");
    preferences["keep"] = json!([1, 2, 3]);
    write_json(sandbox.profile().join("Preferences"), preferences);
    write(sandbox.profile().join("Bookmarks"), "my bookmarks");
    write(sandbox.profile().join("Network/Cookies"), b"my cookies\0");
    let output = sandbox
        .command()
        .env("CHROMIUM_TEST_MISSING_GIT", "1")
        .args(["setup", "--json"])
        .output()
        .unwrap();
    success(output);
    assert_eq!(sandbox.webapp_entries(), entries);
    assert_eq!(fs::read_dir(assets).unwrap().count(), 1);
    assert_eq!(fs::read_to_string(&entries[0]).unwrap(), entry);
    sandbox.assert_fonts_and_bundle(&sandbox.profile(), "Personal");
    assert_eq!(
        read_json(sandbox.profile().join("Preferences"))["keep"],
        json!([1, 2, 3])
    );
    assert_eq!(
        fs::read(sandbox.profile().join("Bookmarks")).unwrap(),
        b"my bookmarks"
    );
    assert_eq!(
        fs::read(sandbox.profile().join("Network/Cookies")).unwrap(),
        b"my cookies\0"
    );
    assert_eq!(snapshot(&sandbox.profile().join("Luna Next/keys")), keys);
    assert_eq!(snapshot(&sandbox.normal()), normal);
    assert!(!sandbox.root.path().join("launched.json").exists());
}

#[test]
fn full_setup_with_an_empty_webapp_catalog_keeps_missing_chromium_profiles_uncreated() {
    let sandbox = Sandbox::new();
    let result = sandbox.success(&["setup", "--json"]);
    assert_eq!(
        result["installed"],
        json!(["ungoogled-chromium-bin", "GNOME Keyring socket"])
    );
    assert_eq!(
        result["skipped"],
        json!(["chromium (run luna chromium setup)"])
    );
    assert!(!sandbox.managed().exists());
    assert!(!sandbox.launcher().exists());
    assert!(!sandbox.root.path().join("launched.json").exists());
    assert!(sandbox.webapp_entries().is_empty());
    assert_eq!(
        sandbox
            .calls()
            .iter()
            .map(|call| call["tool"].clone())
            .collect::<Vec<_>>(),
        vec![json!("yay"), json!("systemctl")]
    );
}

#[test]
fn full_setup_rejects_invalid_or_missing_webapp_catalogs_before_installing_packages() {
    for invalid in [true, false] {
        let sandbox = Sandbox::new();
        let catalog = sandbox.repository.join("installs/packages.webapp.conf");
        if invalid {
            write_json(
                catalog,
                json!([{"name": "YouTube", "url": "file:///tmp/youtube"}]),
            );
        } else {
            fs::remove_file(catalog).unwrap();
        }
        let message = error(sandbox.run(&["setup", "--json"]));
        assert!(!message.is_empty());
        assert!(sandbox.calls().is_empty());
        assert!(!sandbox.managed().exists());
        assert!(sandbox.webapp_entries().is_empty());
    }
}

#[test]
fn full_setup_stops_before_webapps_when_package_configuration_or_keyring_fails() {
    for (variable, value, profile_created, configured) in [
        ("CHROMIUM_TEST_INSTALL_FAIL", "1", false, false),
        ("CHROMIUM_TEST_DOWNLOAD_FAIL", EXTENSIONS[2], true, false),
        ("CHROMIUM_TEST_KEYRING_FAIL", "1", true, true),
    ] {
        let sandbox = Sandbox::new();
        sandbox.youtube_catalog();
        let output = sandbox
            .command()
            .env(variable, value)
            .args(["setup", "--json"])
            .output()
            .unwrap();
        assert!(!error(output).is_empty());
        assert_eq!(sandbox.profile().exists(), profile_created);
        assert_eq!(sandbox.profile().join("Luna Next").exists(), configured);
        assert!(sandbox.webapp_entries().is_empty());
        assert!(!sandbox.root.path().join("launched.json").exists());
        assert!(sandbox.calls().iter().all(|call| {
            call["tool"] != "file"
                && (call["tool"] != "curl"
                    || !call["args"]
                        .as_array()
                        .unwrap()
                        .contains(&json!("https://www.youtube.com/")))
        }));
    }
}

#[test]
fn full_setup_captures_its_launcher_before_reinstalling_the_running_cli() {
    let sandbox = Sandbox::new();
    sandbox.youtube_catalog();
    let running = sandbox.root.path().join("running-luna");
    fs::copy(env!("CARGO_BIN_EXE_luna"), &running).unwrap();
    write(
        sandbox.root.path().join("binary-source"),
        env!("CARGO_BIN_EXE_luna"),
    );
    sandbox.tool(
        "replace-cli",
        r#"import shutil
destination = root / 'running-luna'
# Replacing the live inode makes a late current_exe() resolve to a deleted path.
destination.unlink()
shutil.copy2((root / 'binary-source').read_text(), destination)
"#,
    );
    write_json(
        sandbox.repository.join("installs/packages.local.conf"),
        json!([{
            "name": "cli", "source": "local", "url": "src/ln-cli", "command": [["replace-cli"]]
        }]),
    );
    let output = sandbox
        .command_at(&running)
        .args(["setup", "--json"])
        .output()
        .unwrap();
    success(output);
    let entries = sandbox.webapp_entries();
    assert_eq!(entries.len(), 1);
    let entry = fs::read_to_string(&entries[0]).unwrap();
    assert!(entry.contains(running.to_str().unwrap()), "{entry}");
    assert!(!entry.contains(" (deleted)"), "{entry}");
    assert!(
        sandbox
            .calls()
            .iter()
            .any(|call| call["tool"] == "replace-cli")
    );
    assert!(!sandbox.root.path().join("launched.json").exists());
}

#[test]
fn failed_package_install_does_not_create_profiles_or_download_extensions() {
    let sandbox = Sandbox::new();
    let output = sandbox
        .command()
        .env("CHROMIUM_TEST_INSTALL_FAIL", "1")
        .args(["install", "--aur", "ungoogled-chromium-bin", "--json"])
        .output()
        .unwrap();
    assert!(!error(output).is_empty());
    assert_eq!(sandbox.calls().len(), 1);
    assert_eq!(sandbox.calls()[0]["tool"], "yay");
    assert!(!sandbox.managed().exists());
    assert!(!sandbox.launcher().exists());
}

#[test]
fn creating_requires_provider_version_and_git_identity_before_publication() {
    for missing in ["provider", "git", "version"] {
        let sandbox = Sandbox::new();
        let mut command = sandbox.command();
        if missing == "provider" {
            fs::remove_file(sandbox.root.path().join("provider-installed")).unwrap();
        } else if missing == "git" {
            command.env("CHROMIUM_TEST_MISSING_GIT", "1");
        } else {
            command.env("CHROMIUM_TEST_BAD_VERSION", "1");
        }
        let message = error(
            command
                .args(["chromium", "create-profile", "--json"])
                .output()
                .unwrap(),
        );
        let expected = match missing {
            "provider" => "ungoogled-chromium-bin",
            "git" => "user.name",
            _ => "version",
        };
        assert!(message.contains(expected), "{message}");
        assert!(!sandbox.managed().exists());
        assert!(!sandbox.launcher().exists());
        assert!(sandbox.calls().iter().all(|call| call["tool"] != "curl"));
    }
}

#[test]
fn failed_setup_download_leaves_only_the_created_profile_for_retry() {
    let sandbox = Sandbox::new();
    let output = sandbox
        .command()
        .env("CHROMIUM_TEST_DOWNLOAD_FAIL", EXTENSIONS[2])
        .args(["chromium", "setup", "--json"])
        .output()
        .unwrap();
    assert!(!error(output).is_empty());
    assert_eq!(
        read_json(sandbox.profile().join("Preferences")),
        json!({"profile": {"name": "Luna Test", "using_default_name": false}})
    );
    assert!(sandbox.launcher().is_file());
    assert!(!sandbox.profile().join("Luna Next").exists());
    assert!(!sandbox.root.path().join("launched.json").exists());
}

#[test]
fn failed_refresh_download_preserves_the_existing_profile_bundle_and_launcher() {
    let sandbox = Sandbox::new();
    sandbox.success(&["chromium", "setup", "--json"]);
    let previous = snapshot(&sandbox.profile());
    let launcher = fs::read(sandbox.launcher()).unwrap();
    fs::remove_file(sandbox.root.path().join("launched.json")).unwrap();
    let output = sandbox
        .command()
        .env("CHROMIUM_TEST_DOWNLOAD_FAIL", EXTENSIONS[1])
        .args(["conf", "chromium", "--json"])
        .output()
        .unwrap();
    assert!(!error(output).is_empty());
    assert_eq!(snapshot(&sandbox.profile()), previous);
    assert_eq!(fs::read(sandbox.launcher()).unwrap(), launcher);
    assert!(!sandbox.root.path().join("launched.json").exists());
}

#[test]
fn an_active_shared_browser_root_rejects_configuration_before_downloads() {
    let sandbox = Sandbox::new();
    sandbox.create();
    write(sandbox.managed().join("SingletonLock"), "busy");
    let original = snapshot(&sandbox.profile());
    let before = sandbox.calls().len();
    let message = error(sandbox.run(&["conf", "chromium", "--json"]));
    assert!(message.contains("close Chromium"), "{message}");
    assert_eq!(sandbox.calls().len(), before);
    assert_eq!(snapshot(&sandbox.profile()), original);
    assert!(!sandbox.root.path().join("launched.json").exists());
}
