use std::{
    fs,
    os::unix::fs::{PermissionsExt, symlink},
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
};

use serde_json::{Value, json};
use tempfile::TempDir;

struct Sandbox(TempDir);

impl Sandbox {
    fn new() -> Self {
        let sandbox = Self(tempfile::tempdir().unwrap());
        fs::create_dir_all(sandbox.path("home")).unwrap();
        sandbox.write(
            "config/luna-next/chromium/.luna-managed",
            b"Luna Next Chromium\n",
        );
        sandbox.write(
            "config/luna-next/chromium/Default/Preferences",
            b"{\"profile\":{\"name\":\"Personal\"},\"keep\":true}",
        );
        sandbox.write("config/luna-next/chromium/Local State", b"{\"keep\":true}");
        sandbox.write(
            "config/luna-next/chromium/Default/Bookmarks",
            b"preserved bookmarks",
        );
        sandbox.tool(
            "pacman",
            r#"assert sys.argv[1:] == ['-Q', 'ungoogled-chromium-bin']
sys.exit(1 if os.environ.get('WEBAPP_TEST_MISSING_PROVIDER') else 0)
"#,
        );
        sandbox.tool(
            "chromium",
            r#"args = sys.argv[1:]
if args == ['--version']:
    print('Chromium 156.0.8078.73')
else:
    print('fixture launch diagnostic', file=sys.stderr)
    if os.environ.get('WEBAPP_TEST_LAUNCH_FAIL'):
        sys.exit(17)
    pathlib.Path(os.environ['WEBAPP_TEST_ROOT'], 'launched.json').write_text(json.dumps(args))
"#,
        );
        sandbox.tool(
            "curl",
            r#"import base64
args = sys.argv[1:]
assert args[0] == '--disable', args
assert args[args.index('--write-out') + 1] == '%{url_effective}', args
url = args[args.index('--url') + 1]
with pathlib.Path(os.environ['WEBAPP_TEST_ROOT'], 'downloads.jsonl').open('a') as log:
    log.write(json.dumps(url) + '\n')
if os.environ.get('WEBAPP_TEST_DOWNLOAD_FAIL', '!') in url:
    print('fixture icon download failed', file=sys.stderr)
    sys.exit(22)
if url.endswith(('.png', '.ico')):
    data = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')
else:
    data = b'<html><head><link rel="icon" href="/site-icon.png"></head></html>'
pathlib.Path(args[args.index('--output') + 1]).write_bytes(data)
sys.stdout.write(url)
"#,
        );
        sandbox.tool(
            "file",
            r#"assert sys.argv[1:4] == ['--brief', '--mime-type', '--'], sys.argv
assert pathlib.Path(sys.argv[4]).is_file()
print('image/png')
"#,
        );
        sandbox
    }

    fn path(&self, relative: &str) -> PathBuf {
        self.0.path().join(relative)
    }

    fn write(&self, relative: &str, bytes: &[u8]) {
        let path = self.path(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    fn tool(&self, name: &str, body: &str) {
        let path = self.path(&format!("bin/{name}"));
        self.write(
            &format!("bin/{name}"),
            format!("#!/usr/bin/python3\nimport json, os, pathlib, sys\n{body}").as_bytes(),
        );
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    }

    fn command(&self) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_luna"));
        command
            .env_clear()
            .env("HOME", self.path("home"))
            .env("XDG_CONFIG_HOME", self.path("config"))
            .env("XDG_DATA_HOME", self.path("data"))
            .env("PATH", self.path("bin"))
            .env("WEBAPP_TEST_ROOT", self.0.path())
            .stdin(Stdio::null());
        command
    }

    fn run(&self, args: &[&str]) -> Output {
        self.command().args(args).output().unwrap()
    }

    fn profile(&self) -> PathBuf {
        self.path("config/luna-next/chromium/Default")
    }

    fn desktop_entries(&self) -> Vec<PathBuf> {
        fs::read_dir(self.path("data/applications"))
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| {
                path.extension()
                    .is_some_and(|extension| extension == "desktop")
            })
            .collect()
    }

    fn tty(&self, args: &[&str], input: &str) -> Value {
        let environment = self.command();
        let mut command = Command::new("/usr/bin/python3");
        command.env_clear();
        for (key, value) in environment.get_envs() {
            command.env(key, value.unwrap());
        }
        let output = command
            .env("WEBAPP_TEST_INPUT", input)
            .args([
                "-c",
                r#"import json, os, pty, subprocess, sys
master, slave = pty.openpty()
child = subprocess.Popen(sys.argv[1:], stdin=slave, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
os.close(slave)
try:
    if os.environ['WEBAPP_TEST_INPUT']:
        os.write(master, os.environ['WEBAPP_TEST_INPUT'].encode())
    stdout, stderr = child.communicate(timeout=10)
except BaseException:
    child.kill()
    child.communicate()
    raise
finally:
    os.close(master)
print(json.dumps({'status': child.returncode, 'stdout': stdout.decode(), 'stderr': stderr.decode()}))
"#,
                env!("CARGO_BIN_EXE_luna"),
            ])
            .args(args)
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
        serde_json::from_slice(&output.stdout).unwrap()
    }
}

fn response(output: Output, success: bool) -> Value {
    assert_eq!(output.status.success(), success, "{output:?}");
    assert!(output.stderr.is_empty(), "{output:?}");
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["ok"], success, "{value}");
    if success {
        value["result"].clone()
    } else {
        value["error"].clone()
    }
}

#[test]
fn launches_an_app_window_using_the_luna_default_even_when_chromium_is_open() {
    let sandbox = Sandbox::new();
    symlink(
        "host-123",
        sandbox.path("config/luna-next/chromium/SingletonLock"),
    )
    .unwrap();
    let preferences = fs::read(sandbox.profile().join("Preferences")).unwrap();
    let state = fs::read(sandbox.path("config/luna-next/chromium/Local State")).unwrap();
    let url = "https://www.youtube.com/watch?v=one&list=two#chapter";
    let result = response(sandbox.run(&["webapp", "launch", url, "--json"]), true);
    assert_eq!(result["url"], url);
    assert_eq!(result["profile"], json!(sandbox.profile()));
    let arguments: Vec<String> =
        serde_json::from_slice(&fs::read(sandbox.path("launched.json")).unwrap()).unwrap();
    assert!(arguments.contains(&format!("--app={url}")));
    assert!(arguments.contains(&format!(
        "--user-data-dir={}",
        sandbox.profile().parent().unwrap().display()
    )));
    assert!(arguments.contains(&"--profile-directory=Default".into()));
    assert!(
        arguments
            .iter()
            .all(|arg| !arg.starts_with("--headless") && !arg.starts_with("--load-extension"))
    );
    assert_eq!(
        fs::read(sandbox.profile().join("Preferences")).unwrap(),
        preferences
    );
    assert_eq!(
        fs::read(sandbox.path("config/luna-next/chromium/Local State")).unwrap(),
        state
    );
}

#[test]
fn profile_override_uses_the_exact_directory_with_human_output() {
    let sandbox = Sandbox::new();
    sandbox.write(
        "other browser/Profile 2/Preferences",
        b"{\"profile\":{\"name\":\"Work\"}}",
    );
    let selected = sandbox.path("other browser/Profile 2");
    let output = sandbox
        .command()
        .args(["webapp", "launch", "https://web.whatsapp.com/", "--profile"])
        .arg(&selected)
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    assert!(output.stderr.is_empty(), "{output:?}");
    assert!(
        String::from_utf8(output.stdout)
            .unwrap()
            .contains("Opened web app")
    );
    let arguments: Vec<String> =
        serde_json::from_slice(&fs::read(sandbox.path("launched.json")).unwrap()).unwrap();
    assert!(arguments.contains(&format!(
        "--user-data-dir={}",
        selected.parent().unwrap().display()
    )));
    assert!(arguments.contains(&"--profile-directory=Profile 2".into()));
    assert!(!sandbox.profile().join("Luna Next").exists());
}

#[test]
fn invalid_urls_and_missing_profiles_report_errors_without_starting_a_browser() {
    for url in [
        "file:///etc/passwd",
        "javascript:alert(1)",
        "https://user:password@example.com",
        "https://example.com/\n--other",
    ] {
        let sandbox = Sandbox::new();
        response(sandbox.run(&["webapp", "launch", url, "--json"]), false);
        assert!(!sandbox.path("launched.json").exists());
    }
    let sandbox = Sandbox::new();
    fs::remove_dir_all(sandbox.profile()).unwrap();
    let error = response(
        sandbox.run(&["webapp", "launch", "https://x.com/", "--json"]),
        false,
    );
    assert!(error.as_str().unwrap().contains("profile"));
    assert!(!sandbox.profile().exists());
    assert!(!sandbox.path("launched.json").exists());
}

#[test]
fn provider_and_launch_failures_keep_json_clean() {
    for variable in ["WEBAPP_TEST_MISSING_PROVIDER", "WEBAPP_TEST_LAUNCH_FAIL"] {
        let sandbox = Sandbox::new();
        let output = sandbox
            .command()
            .env(variable, "1")
            .args(["webapp", "launch", "https://example.com/", "--json"])
            .output()
            .unwrap();
        let error = response(output, false);
        assert!(!error.as_str().unwrap().is_empty());
    }
}

#[test]
fn webapp_help_describes_the_profile_option() {
    let sandbox = Sandbox::new();
    let output = sandbox.run(&["webapp", "launch", "--help"]);
    assert!(output.status.success());
    let help = String::from_utf8(output.stdout).unwrap();
    assert!(help.contains("--profile <PATH>"));
    assert!(help.contains("<URL>"));
}

#[test]
fn installs_a_menu_entry_and_discovered_icon_without_launching_or_changing_the_profile() {
    let sandbox = Sandbox::new();
    let preferences = fs::read(sandbox.profile().join("Preferences")).unwrap();
    let state = fs::read(sandbox.path("config/luna-next/chromium/Local State")).unwrap();
    let url = "https://example.invalid/chat";
    let installed = response(
        sandbox.run(&[
            "webapp",
            "install",
            "--name",
            "Example Chat",
            "--url",
            url,
            "--json",
        ]),
        true,
    );
    assert_eq!(installed["name"], "Example Chat");
    assert_eq!(installed["url"], url);
    assert_eq!(installed["profile"], json!(sandbox.profile()));
    let desktop = Path::new(installed["desktop_file"].as_str().unwrap());
    let icon = Path::new(installed["icon"].as_str().unwrap());
    assert_eq!(desktop.parent().unwrap(), sandbox.path("data/applications"));
    assert!(icon.starts_with(sandbox.path("data/luna-next/webapps")));
    let entry = fs::read_to_string(desktop).unwrap();
    assert!(entry.contains("Name=Example Chat\n"));
    assert!(entry.contains(url));
    assert!(fs::read(icon).unwrap().starts_with(b"\x89PNG\r\n\x1a\n"));
    let downloads: Vec<String> = fs::read_to_string(sandbox.path("downloads.jsonl"))
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(downloads, [url, "https://example.invalid/site-icon.png"]);
    assert!(!sandbox.path("launched.json").exists());
    assert_eq!(
        fs::read(sandbox.profile().join("Preferences")).unwrap(),
        preferences
    );
    assert_eq!(
        fs::read(sandbox.path("config/luna-next/chromium/Local State")).unwrap(),
        state
    );
}

#[test]
fn install_accepts_an_exact_profile_and_explicit_icon_with_human_output() {
    let sandbox = Sandbox::new();
    sandbox.write(
        "other browser/Profile 2/Preferences",
        b"{\"profile\":{\"name\":\"Work\"}}",
    );
    let selected = sandbox.path("other browser/Profile 2");
    let output = sandbox
        .command()
        .args([
            "webapp",
            "install",
            "--name",
            "Work Chat",
            "--url",
            "https://example.invalid/work",
            "--icon-url",
            "https://icons.invalid/custom.png",
            "--profile",
        ])
        .arg(&selected)
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    assert!(output.stderr.is_empty(), "{output:?}");
    assert!(
        String::from_utf8(output.stdout)
            .unwrap()
            .contains("Work Chat")
    );
    let entries = sandbox.desktop_entries();
    assert_eq!(entries.len(), 1);
    let entry = fs::read_to_string(&entries[0]).unwrap();
    assert!(entry.contains("Name=Work Chat\n"));
    assert!(entry.contains("Profile 2"));
    let downloads: Vec<String> = fs::read_to_string(sandbox.path("downloads.jsonl"))
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(downloads, ["https://icons.invalid/custom.png"]);
    assert!(!sandbox.path("launched.json").exists());
    assert_eq!(
        fs::read(selected.join("Preferences")).unwrap(),
        b"{\"profile\":{\"name\":\"Work\"}}"
    );
}

#[test]
fn reinstall_replaces_the_same_entry_and_a_failed_refresh_keeps_the_previous_files() {
    let sandbox = Sandbox::new();
    let first = response(
        sandbox.run(&[
            "webapp",
            "install",
            "--name",
            "Chat",
            "--url",
            "https://example.invalid/first",
            "--json",
        ]),
        true,
    );
    let second = response(
        sandbox.run(&[
            "webapp",
            "install",
            "--name",
            "Chat",
            "--url",
            "https://example.invalid/second",
            "--json",
        ]),
        true,
    );
    assert_eq!(first["desktop_file"], second["desktop_file"]);
    assert_eq!(first["icon"], second["icon"]);
    assert_eq!(sandbox.desktop_entries().len(), 1);
    let desktop = Path::new(second["desktop_file"].as_str().unwrap());
    let icon = Path::new(second["icon"].as_str().unwrap());
    let original_desktop = fs::read(desktop).unwrap();
    let original_icon = fs::read(icon).unwrap();
    assert!(String::from_utf8_lossy(&original_desktop).contains("https://example.invalid/second"));
    let output = sandbox
        .command()
        .env("WEBAPP_TEST_DOWNLOAD_FAIL", "broken.png")
        .args([
            "webapp",
            "install",
            "--name",
            "Chat",
            "--url",
            "https://example.invalid/third",
            "--icon-url",
            "https://icons.invalid/broken.png",
            "--json",
        ])
        .output()
        .unwrap();
    let error = response(output, false);
    assert!(!error.as_str().unwrap().is_empty());
    assert_eq!(fs::read(desktop).unwrap(), original_desktop);
    assert_eq!(fs::read(icon).unwrap(), original_icon);
    assert!(!sandbox.path("launched.json").exists());
}

#[test]
fn missing_install_fields_return_clean_json_without_prompting_on_a_pipe_or_terminal() {
    for args in [
        vec!["webapp", "install", "--json"],
        vec!["webapp", "install", "--name", "Chat", "--json"],
        vec![
            "--json",
            "webapp",
            "install",
            "--url",
            "https://example.invalid/chat",
        ],
    ] {
        let sandbox = Sandbox::new();
        let error = response(sandbox.run(&args), false);
        let error = error.as_str().unwrap();
        assert!(
            error.contains("--name") || error.contains("--url"),
            "{error}"
        );
        assert!(!sandbox.path("downloads.jsonl").exists());
        assert!(!sandbox.path("data/applications").exists());
    }
    let sandbox = Sandbox::new();
    let terminal = sandbox.tty(&["webapp", "install", "--json"], "");
    assert_ne!(terminal["status"], 0);
    assert_eq!(terminal["stderr"], "");
    let response: Value = serde_json::from_str(terminal["stdout"].as_str().unwrap()).unwrap();
    assert_eq!(response["ok"], false);
    assert!(!sandbox.path("downloads.jsonl").exists());
    let output = sandbox.run(&["webapp", "install"]);
    assert!(!output.status.success(), "{output:?}");
    assert!(output.stdout.is_empty(), "{output:?}");
    let message = String::from_utf8(output.stderr).unwrap();
    assert!(
        message.contains("--name") && message.contains("--url"),
        "{message}"
    );
}

#[test]
fn terminal_install_prompts_for_both_fields_or_only_the_missing_field() {
    for (args, input, name, url) in [
        (
            vec!["webapp", "install"],
            "Prompted Chat\nhttps://example.invalid/prompted\n",
            "Prompted Chat",
            "https://example.invalid/prompted",
        ),
        (
            vec!["webapp", "install", "--name", "Provided Chat"],
            "https://example.invalid/provided\n",
            "Provided Chat",
            "https://example.invalid/provided",
        ),
        (
            vec![
                "webapp",
                "install",
                "--url",
                "https://example.invalid/supplied",
            ],
            "Prompted Name\n",
            "Prompted Name",
            "https://example.invalid/supplied",
        ),
    ] {
        let sandbox = Sandbox::new();
        let terminal = sandbox.tty(&args, input);
        assert_eq!(terminal["status"], 0, "{terminal}");
        let prompts = terminal["stderr"].as_str().unwrap();
        assert_eq!(prompts.contains("Name: "), !args.contains(&"--name"));
        assert_eq!(prompts.contains("URL: "), !args.contains(&"--url"));
        let entries = sandbox.desktop_entries();
        assert_eq!(entries.len(), 1);
        let desktop = fs::read_to_string(&entries[0]).unwrap();
        assert!(desktop.contains(&format!("Name={name}\n")), "{desktop}");
        assert!(desktop.contains(url), "{desktop}");
        assert!(!sandbox.path("launched.json").exists());
    }
}

#[test]
fn install_help_exposes_the_required_inputs_profile_and_icon_options() {
    let sandbox = Sandbox::new();
    let output = sandbox.run(&["webapp", "install", "--help"]);
    assert!(output.status.success(), "{output:?}");
    let help = String::from_utf8(output.stdout).unwrap();
    for option in ["--name", "--url", "--profile", "--icon-url"] {
        assert!(help.contains(option), "{help}");
    }
    assert!(!sandbox.path("downloads.jsonl").exists());
}
