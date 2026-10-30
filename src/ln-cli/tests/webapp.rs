use std::{
    fs,
    os::unix::fs::{PermissionsExt, symlink},
    path::PathBuf,
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
