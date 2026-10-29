use serde_json::{Value, json};
use std::{
    fs,
    os::unix::fs::{PermissionsExt, symlink},
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
};
use tempfile::TempDir;

struct Sandbox {
    root: TempDir,
    config: PathBuf,
    renderer: PathBuf,
}

impl Sandbox {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let config = root.path().join("config/luna-next/wallpaper.conf");
        let renderer = root.path().join("renderer/shell.qml");
        fs::create_dir_all(renderer.parent().unwrap()).unwrap();
        fs::write(&renderer, "// isolated fake renderer\n").unwrap();
        let bin = root.path().join("bin");
        fs::create_dir(&bin).unwrap();
        executable(
            &bin.join("qs"),
            r##"#!/bin/sh
case "$1" in
  list)
    if test -f "$FAKE_STATE"; then
      printf '[{"config_path":"%s","pid":4242}]\n' "$LUNA_WALLPAPER_SHELL"
    else
      printf '[]\n'
    fi ;;
  kill) /bin/rm -f "$FAKE_STATE"; printf 'stop\n' >> "$FAKE_LOG" ;;
  -p) printf 'running\n' > "$FAKE_STATE"; printf 'start\n' >> "$FAKE_LOG" ;;
  ipc)
    if test -n "$FAKE_FAIL_MATCH"; then
      while IFS= read -r line; do
        case "$line" in
          *"$FAKE_FAIL_MATCH"*)
            if test -n "$FAKE_EXTERNAL_SOURCE"; then
              /bin/cp "$FAKE_EXTERNAL_SOURCE" "$FAKE_CONFIG"
            fi
            printf 'error\n'
            exit 0 ;;
        esac
      done < "$FAKE_CONFIG"
    fi
    printf 'ready\n' ;;
  *) printf 'unexpected fake Quickshell command\n' >&2; exit 9 ;;
esac
"##,
        );
        executable(&bin.join("file"), "#!/bin/sh\nprintf 'image/png\\n'\n");
        executable(
            &bin.join("curl"),
            r##"#!/bin/sh
while test "$#" -gt 0; do
  if test "$1" = --output; then
    shift
    printf 'downloaded image bytes\n' > "$1"
    exit 0
  fi
  shift
done
exit 8
"##,
        );
        Self {
            root,
            config,
            renderer,
        }
    }

    fn command(&self) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_lnxt"));
        command
            .env_clear()
            .env("HOME", self.root.path())
            .env("XDG_CONFIG_HOME", self.root.path().join("config"))
            .env("XDG_DATA_HOME", self.root.path().join("data"))
            .env("XDG_RUNTIME_DIR", self.root.path())
            .env("LUNA_WALLPAPER_SHELL", &self.renderer)
            .env("PATH", self.root.path().join("bin"))
            .env("WAYLAND_DISPLAY", "test-wayland")
            .env("FAKE_STATE", self.root.path().join("running"))
            .env("FAKE_LOG", self.root.path().join("runtime.log"))
            .env("FAKE_CONFIG", &self.config)
            .current_dir(self.root.path())
            .stdin(Stdio::null());
        command
    }

    fn run(&self, arguments: &[&str]) -> Output {
        self.command().args(arguments).output().unwrap()
    }

    fn success(&self, arguments: &[&str]) -> Value {
        let output = self.run(arguments);
        assert!(output.status.success(), "{output:?}");
        assert!(output.stderr.is_empty(), "{output:?}");
        let response: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(response["ok"], true, "{response}");
        response["result"].clone()
    }

    fn write_config(&self, source: &str) {
        fs::create_dir_all(self.config.parent().unwrap()).unwrap();
        fs::write(&self.config, source).unwrap();
    }

    fn library(&self) -> PathBuf {
        self.root.path().join("data/luna-next/wallpapers")
    }
}

fn executable(path: &Path, source: &str) {
    fs::write(path, source).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
}

#[test]
fn json_option_works_at_every_level_and_alias_uses_xdg_paths() {
    let sandbox = Sandbox::new();
    assert_eq!(
        sandbox.success(&["--json", "w", "get-config-file"]),
        json!(sandbox.config)
    );
    assert_eq!(
        sandbox.success(&["wallpaper", "--json", "dir"]),
        json!(sandbox.library())
    );
    assert_eq!(
        sandbox.success(&["wallpaper", "get-config", "absent", "--json"]),
        Value::Null
    );
    assert!(sandbox.config.exists());
}

#[test]
fn help_does_not_create_files_and_explicit_configuration_wins() {
    let sandbox = Sandbox::new();
    let help = sandbox.run(&["--help"]);
    assert!(help.status.success());
    assert!(
        String::from_utf8(help.stdout)
            .unwrap()
            .contains("wallpaper")
    );
    assert!(!sandbox.config.exists());
    let custom = sandbox.root.path().join("custom.conf");
    let output = sandbox
        .command()
        .env("LUNA_WALLPAPER_CONFIG", &custom)
        .args(["wallpaper", "get-config-file", "--json"])
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    let response: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["result"], json!(custom));
}

#[test]
fn reads_includes_and_formats_human_values() {
    let sandbox = Sandbox::new();
    sandbox.write_config("include file(\"defaults.conf\")\nwallpaper.fit = fit\n");
    fs::write(
        sandbox.config.with_file_name("defaults.conf"),
        "wallpaper { fit = fill, background_color = \"#112233\" }\n",
    )
    .unwrap();
    let value = sandbox.success(&["wallpaper", "get-config", "wallpaper", "--json"]);
    assert_eq!(value["fit"], "fit");
    assert_eq!(value["background_color"], "#112233");
    let scalar = sandbox.run(&["wallpaper", "get-config", "wallpaper.fit"]);
    assert!(scalar.status.success());
    assert_eq!(scalar.stdout, b"fit\n");
    let missing = sandbox.run(&["wallpaper", "get-config", "absent"]);
    assert!(missing.status.success());
    assert!(missing.stdout.is_empty());
}

#[test]
fn json_failures_have_one_envelope_and_nonzero_exit() {
    let sandbox = Sandbox::new();
    for arguments in [
        vec!["wallpaper", "unknown-command", "--json"],
        vec!["wallpaper", "update-config", "{", "--json"],
        vec![
            "wallpaper",
            "update-config",
            "{\"wallpaper\":{\"fit\":\"banana\"}}",
            "--json",
        ],
    ] {
        let output = sandbox.run(&arguments);
        assert!(!output.status.success(), "{output:?}");
        assert!(output.stderr.is_empty(), "{output:?}");
        let response: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(response["ok"], false);
        assert!(
            response["error"]
                .as_str()
                .is_some_and(|text| !text.is_empty())
        );
    }
    assert!(!sandbox.root.path().join("runtime.log").exists());
}

#[test]
fn imports_lists_previews_and_removes_without_json_prompts() {
    let sandbox = Sandbox::new();
    let source = sandbox.root.path().join("sample.png");
    fs::write(&source, b"sample image").unwrap();
    let imported = sandbox.success(&["wallpaper", "add", source.to_str().unwrap(), "--json"]);
    assert_eq!(imported[0]["added"], true);
    let path = sandbox.library().join("sample.png");
    assert_eq!(imported[0]["path"], json!(path));
    let listing = sandbox.success(&["wallpaper", "list", "--json"]);
    assert_eq!(listing[0]["path"], json!(path));
    assert_eq!(listing[0]["current"], false);
    let denied = sandbox.run(&["wallpaper", "remove", "sample.png", "--json"]);
    assert!(!denied.status.success());
    assert!(denied.stderr.is_empty());
    assert!(path.exists());
    let preview = sandbox.success(&["wallpaper", "remove", "sample.png", "--dry-run", "--json"]);
    assert_eq!(preview, json!([path]));
    assert!(path.exists());
    assert_eq!(
        sandbox.success(&["wallpaper", "remove", "sample.png", "--yes", "--json"]),
        json!([path])
    );
    assert!(!path.exists());
}

#[test]
fn update_config_preserves_include_and_automatically_restarts() {
    let sandbox = Sandbox::new();
    sandbox.write_config("# keep comment\ninclude file(\"defaults.conf\")\n");
    let defaults = sandbox.config.with_file_name("defaults.conf");
    let original = "wallpaper.fit = fill\n";
    fs::write(&defaults, original).unwrap();
    fs::write(sandbox.root.path().join("running"), "running").unwrap();
    let mut expected = sandbox.success(&["wallpaper", "get-config", "--json"]);
    expected["wallpaper"]["fit"] = json!("fit");
    let value = sandbox.success(&[
        "wallpaper",
        "update-config",
        "{\"wallpaper\":{\"fit\":\"fit\"}}",
        "--json",
    ]);
    assert_eq!(value, expected);
    let source = fs::read_to_string(&sandbox.config).unwrap();
    assert!(source.contains("# keep comment"));
    assert!(source.contains("include file(\"defaults.conf\")"));
    assert_eq!(fs::read_to_string(defaults).unwrap(), original);
    assert_eq!(
        fs::read_to_string(sandbox.root.path().join("runtime.log")).unwrap(),
        "stop\nstart\n"
    );
}

#[test]
fn set_and_random_apply_the_selection_and_protect_current_file() {
    let sandbox = Sandbox::new();
    fs::create_dir_all(sandbox.library()).unwrap();
    let first = sandbox.library().join("first.png");
    let second = sandbox.library().join("second.png");
    fs::write(&first, "first image").unwrap();
    fs::write(&second, "second image").unwrap();
    let mut expected = sandbox.success(&["wallpaper", "get-config", "--json"]);
    expected["wallpaper"]["source"] = json!(first);
    let selected = sandbox.success(&["wallpaper", "set", "first.png", "--json"]);
    assert_eq!(selected, expected);
    let denied = sandbox.run(&["wallpaper", "remove", "first.png", "--yes", "--json"]);
    assert!(!denied.status.success());
    assert!(first.exists());
    expected["wallpaper"]["source"] = json!(second);
    let random = sandbox.success(&["wallpaper", "random", "--json"]);
    assert_eq!(random, expected);
    assert_eq!(
        fs::read_to_string(sandbox.root.path().join("runtime.log")).unwrap(),
        "start\nstop\nstart\n"
    );
}

#[test]
fn wallpaper_mutations_print_concise_human_success_messages() {
    let sandbox = Sandbox::new();
    fs::create_dir_all(sandbox.library()).unwrap();
    let first = sandbox.library().join("first.png");
    let second = sandbox.library().join("second.png");
    fs::write(&first, "first image").unwrap();
    fs::write(&second, "second image").unwrap();
    for (arguments, expected) in [
        (
            vec!["w", "set", "first.png"],
            format!("Wallpaper: {}\n", first.display()),
        ),
        (
            vec!["w", "random"],
            format!("Wallpaper: {}\n", second.display()),
        ),
        (
            vec!["w", "update-config", "{\"wallpaper\":{\"fit\":\"center\"}}"],
            "Wallpaper configuration updated.\n".into(),
        ),
    ] {
        let output = sandbox.run(&arguments);
        assert!(output.status.success(), "{output:?}");
        assert!(output.stderr.is_empty(), "{output:?}");
        assert_eq!(String::from_utf8(output.stdout).unwrap(), expected);
    }
    let config = sandbox.success(&["w", "get-config", "--json"]);
    assert_eq!(config["wallpaper"]["source"], json!(second));
    assert_eq!(config["wallpaper"]["fit"], "center");
}

#[test]
fn lifecycle_commands_return_status_without_contaminating_json() {
    let sandbox = Sandbox::new();
    assert_eq!(
        sandbox.success(&["wallpaper", "status", "--json"]),
        "stopped"
    );
    assert_eq!(sandbox.success(&["wallpaper", "start", "--json"]), "ready");
    assert_eq!(sandbox.success(&["wallpaper", "start", "--json"]), "ready");
    assert_eq!(sandbox.success(&["wallpaper", "reload", "--json"]), "ready");
    assert_eq!(
        sandbox.success(&["wallpaper", "restart", "--json"]),
        "ready"
    );
    assert_eq!(sandbox.success(&["wallpaper", "stop", "--json"]), "stopped");
    assert_eq!(
        fs::read_to_string(sandbox.root.path().join("runtime.log")).unwrap(),
        "start\nstop\nstart\nstop\nstart\nstop\n"
    );
}

#[test]
fn url_import_uses_http_downloader_without_network() {
    let sandbox = Sandbox::new();
    let imported = sandbox.success(&[
        "wallpaper",
        "add",
        "https://example.invalid/wallpaper.png",
        "--json",
    ]);
    assert_eq!(
        imported[0]["path"],
        json!(sandbox.library().join("wallpaper.png"))
    );
    assert_eq!(
        fs::read_to_string(sandbox.library().join("wallpaper.png")).unwrap(),
        "downloaded image bytes\n"
    );
}

#[test]
fn empty_and_nested_empty_patches_preserve_source_without_restarting() {
    let sandbox = Sandbox::new();
    let original = "# keep spacing and comments\ninclude file(\"defaults.conf\")\n\nwallpaper {\n  fit = fit # local setting\n}\n";
    sandbox.write_config(original);
    let defaults = sandbox.config.with_file_name("defaults.conf");
    let original_defaults = "wallpaper.background_color = \"#112233\"\n";
    fs::write(&defaults, original_defaults).unwrap();
    fs::write(sandbox.root.path().join("running"), "running").unwrap();
    for patch in [
        "{}",
        "{\"wallpaper\":{}}",
        "{\"wallpaper\":{},\"transition\":{},\"custom\":{\"nested\":{}}}",
    ] {
        let result = sandbox.success(&["wallpaper", "update-config", patch, "--json"]);
        assert_eq!(result["wallpaper"]["fit"], "fit");
        assert_eq!(result["wallpaper"]["background_color"], "#112233");
        assert_eq!(fs::read_to_string(&sandbox.config).unwrap(), original);
        assert_eq!(fs::read_to_string(&defaults).unwrap(), original_defaults);
        assert!(!sandbox.root.path().join("runtime.log").exists());
    }
}

#[test]
fn empty_patches_cannot_bypass_validation_of_the_existing_configuration() {
    let sandbox = Sandbox::new();
    let original = "# invalid section must not become an empty object\nwallpaper = 7\n";
    sandbox.write_config(original);
    for patch in ["{}", "{\"wallpaper\":{}}"] {
        let output = sandbox.run(&["wallpaper", "update-config", patch, "--json"]);
        assert!(!output.status.success(), "{output:?}");
        assert!(output.stderr.is_empty(), "{output:?}");
        let response: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(response["ok"], false);
        assert_eq!(fs::read_to_string(&sandbox.config).unwrap(), original);
        assert!(!sandbox.root.path().join("runtime.log").exists());
    }
}

#[test]
fn failed_apply_restores_exact_source_symlink_permissions_and_running_renderer() {
    let sandbox = Sandbox::new();
    let original = "# exact original source\ninclude file(\"defaults.conf\")\n\nwallpaper.fit = fill # keep this\n";
    sandbox.write_config(original);
    let defaults = sandbox.config.with_file_name("defaults.conf");
    let original_defaults = "wallpaper.background_color = \"#112233\"\n";
    fs::write(&defaults, original_defaults).unwrap();
    let target = sandbox.config.with_file_name("real.conf");
    fs::rename(&sandbox.config, &target).unwrap();
    fs::set_permissions(&target, fs::Permissions::from_mode(0o640)).unwrap();
    symlink("real.conf", &sandbox.config).unwrap();
    fs::write(sandbox.root.path().join("running"), "running").unwrap();
    let output = sandbox
        .command()
        .env("FAKE_FAIL_MATCH", "#ABCDEF")
        .args([
            "wallpaper",
            "update-config",
            "{\"wallpaper\":{\"background_color\":\"#ABCDEF\"}}",
            "--json",
        ])
        .output()
        .unwrap();
    assert!(!output.status.success(), "{output:?}");
    assert!(output.stderr.is_empty(), "{output:?}");
    let response: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["ok"], false);
    assert!(response["error"].as_str().unwrap().contains("restored"));
    assert_eq!(fs::read_to_string(&target).unwrap(), original);
    assert_eq!(fs::read_to_string(&sandbox.config).unwrap(), original);
    assert_eq!(fs::read_to_string(&defaults).unwrap(), original_defaults);
    assert_eq!(
        fs::read_link(&sandbox.config).unwrap(),
        Path::new("real.conf")
    );
    assert_eq!(
        fs::metadata(&target).unwrap().permissions().mode() & 0o777,
        0o640
    );
    assert_eq!(
        fs::read_to_string(sandbox.root.path().join("runtime.log")).unwrap(),
        "stop\nstart\nstop\nstart\n"
    );
    assert_eq!(sandbox.success(&["wallpaper", "status", "--json"]), "ready");
}

#[test]
fn substituted_invalid_candidate_is_rejected_before_saving_or_restarting() {
    let sandbox = Sandbox::new();
    let original = "# duration is shared through a substitution\nduration = 200\ntransition.duration_ms = ${duration}\n";
    sandbox.write_config(original);
    let output = sandbox.run(&["wallpaper", "update-config", "{\"duration\":-1}", "--json"]);
    assert!(!output.status.success(), "{output:?}");
    assert!(output.stderr.is_empty(), "{output:?}");
    let response: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["ok"], false);
    assert!(response["error"].as_str().unwrap().contains("duration_ms"));
    assert_eq!(fs::read_to_string(&sandbox.config).unwrap(), original);
    assert!(!sandbox.root.path().join("runtime.log").exists());
}

#[test]
fn stop_works_with_missing_or_malformed_configuration_without_creating_an_entry() {
    let missing = Sandbox::new();
    fs::write(missing.root.path().join("running"), "running").unwrap();
    assert!(!missing.config.exists());
    assert_eq!(missing.success(&["wallpaper", "stop", "--json"]), "stopped");
    assert!(!missing.config.exists());
    let malformed = Sandbox::new();
    let original = "wallpaper { fit = \"unterminated\n";
    malformed.write_config(original);
    fs::write(malformed.root.path().join("running"), "running").unwrap();
    assert_eq!(
        malformed.success(&["wallpaper", "stop", "--json"]),
        "stopped"
    );
    assert_eq!(fs::read_to_string(&malformed.config).unwrap(), original);
    assert_eq!(
        fs::read_to_string(malformed.root.path().join("runtime.log")).unwrap(),
        "stop\n"
    );
}

#[test]
fn external_edit_during_failed_apply_is_not_overwritten_by_rollback() {
    let sandbox = Sandbox::new();
    sandbox.write_config("# initial configuration\nwallpaper.fit = fill\n");
    let external = "# changed by an external editor\nwallpaper.fit = center\n";
    let external_source = sandbox.root.path().join("external.conf");
    fs::write(&external_source, external).unwrap();
    fs::write(sandbox.root.path().join("running"), "running").unwrap();
    let output = sandbox
        .command()
        .env("FAKE_FAIL_MATCH", "#ABCDEF")
        .env("FAKE_EXTERNAL_SOURCE", external_source)
        .args([
            "wallpaper",
            "update-config",
            "{\"wallpaper\":{\"background_color\":\"#ABCDEF\"}}",
            "--json",
        ])
        .output()
        .unwrap();
    assert!(!output.status.success(), "{output:?}");
    assert!(output.stderr.is_empty(), "{output:?}");
    let response: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["ok"], false);
    assert!(response["error"].as_str().unwrap().contains("externally"));
    assert_eq!(fs::read_to_string(&sandbox.config).unwrap(), external);
    assert_eq!(
        fs::read_to_string(sandbox.root.path().join("runtime.log")).unwrap(),
        "stop\nstart\n"
    );
}
