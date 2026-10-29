use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
};

use serde_json::{Value, json};
use tempfile::TempDir;

struct Sandbox {
    root: TempDir,
    repository: PathBuf,
}

impl Sandbox {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let repository = root.path().join("checkout");
        fs::create_dir_all(repository.join("installs")).unwrap();
        fs::create_dir_all(repository.join("src/ln-cli")).unwrap();
        fs::write(repository.join("Cargo.toml"), "[workspace]\nmembers = []\n").unwrap();
        write_json(
            &repository.join("installs/packages.conf"),
            json!({
                "core": [{"name": "git", "source": "pacman"}],
                "main": [
                    {"name": "mpv", "source": "pacman"},
                    {"name": "mpvpaper", "source": "aur"}
                ]
            }),
        );
        write_json(
            &repository.join("installs/packages.mise.conf"),
            json!([{"name": "rust", "source": "mise", "version": "stable"}]),
        );
        write_json(
            &repository.join("installs/packages.local.conf"),
            json!([{
                "name": "cli", "source": "local", "url": "src/ln-cli",
                "command": [["fake-build", "cli"]]
            }]),
        );
        write_json(&repository.join("installs/packages.git.conf"), json!([]));
        let bin = root.path().join("bin");
        fs::create_dir(&bin).unwrap();
        fs::create_dir(root.path().join("home")).unwrap();
        executable(&bin.join("sudo"), "#!/bin/sh\nexec \"$@\"\n");
        executable(&bin.join("git"), "#!/bin/sh\nexec /usr/bin/git \"$@\"\n");
        for tool in ["pacman", "yay", "mise", "fake-build"] {
            executable(
                &bin.join(tool),
                &format!(
                    "#!/bin/sh\nprintf '{tool}' >> \"$FAKE_LOG\"\n\
                     for argument do printf '\\t%s' \"$argument\" >> \"$FAKE_LOG\"; done\n\
                     printf '\\n' >> \"$FAKE_LOG\"\n\
                     printf 'fake {tool} progress\\n'\n\
                     if test \"${{FAKE_FAIL:-}}\" = '{tool}'; then exit 17; fi\n"
                ),
            );
        }
        Self { root, repository }
    }

    fn git_recipe(&self) -> PathBuf {
        let remote = self.root.path().join("remote");
        fs::create_dir(&remote).unwrap();
        git(&remote, &["init", "--initial-branch=main"]);
        fs::write(remote.join("source.txt"), "source").unwrap();
        git(&remote, &["add", "source.txt"]);
        git(&remote, &["commit", "--message", "test source"]);
        write_json(
            &self.repository.join("installs/packages.git.conf"),
            json!([{
                "name": "yay", "source": "git", "url": remote,
                "command": [["fake-build", "yay"]]
            }]),
        );
        remote
    }

    fn app_config(&self, name: &str) -> PathBuf {
        let app = self.repository.join("apps").join(name);
        fs::create_dir_all(app.join("config")).unwrap();
        fs::write(app.join("config/file.conf"), "setting = default\n").unwrap();
        write_json(
            &app.join("app.conf"),
            json!({
                "config": "config",
                "exports": [{"source": "file.conf", "target": format!("{name}/file.conf")}]
            }),
        );
        self.root.path().join("config").join(name).join("file.conf")
    }

    fn command(&self) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_lnxt"));
        command
            .env_clear()
            .env("HOME", self.root.path().join("home"))
            .env("XDG_CONFIG_HOME", self.root.path().join("config"))
            .env("PATH", self.root.path().join("bin"))
            .env("FAKE_LOG", self.root.path().join("commands.log"))
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_ALLOW_PROTOCOL", "file")
            .current_dir(&self.repository)
            .stdin(Stdio::null());
        command
    }

    fn run(&self, arguments: &[&str]) -> Output {
        self.command().args(arguments).output().unwrap()
    }

    fn success(&self, arguments: &[&str]) -> Value {
        let output = self.run(arguments);
        assert!(output.status.success(), "{output:?}");
        let response: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(response["ok"], true, "{response}");
        response["result"].clone()
    }

    fn log(&self) -> String {
        fs::read_to_string(self.root.path().join("commands.log")).unwrap_or_default()
    }
}

fn executable(path: &Path, source: &str) {
    fs::write(path, source).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
}

fn write_json(path: &Path, value: Value) {
    fs::write(path, serde_json::to_string(&value).unwrap()).unwrap();
}

fn git(directory: &Path, arguments: &[&str]) -> String {
    let output = Command::new("/usr/bin/git")
        .arg("-C")
        .arg(directory)
        .args(arguments)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_AUTHOR_NAME", "Luna Test")
        .env("GIT_AUTHOR_EMAIL", "luna-test@example.invalid")
        .env("GIT_COMMITTER_NAME", "Luna Test")
        .env("GIT_COMMITTER_EMAIL", "luna-test@example.invalid")
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    String::from_utf8(output.stdout).unwrap().trim().into()
}

#[test]
fn group_and_source_selectors_install_only_matching_packages() {
    let sandbox = Sandbox::new();
    let result = sandbox.success(&["install", "--core", "--main", "--pacman", "--json"]);
    assert_eq!(result["installed"], json!(["git", "mpv"]));
    assert_eq!(
        sandbox.log(),
        "pacman\t-S\t--needed\t--noconfirm\t--\tgit\tmpv\n"
    );
}

#[test]
fn aur_group_selection_uses_only_the_aur_helper() {
    let sandbox = Sandbox::new();
    let result = sandbox.success(&["--json", "install", "--main", "--aur"]);
    assert_eq!(result["installed"], json!(["mpvpaper"]));
    assert_eq!(
        sandbox.log(),
        "yay\t-S\t--aur\t--needed\t--noconfirm\t--\tmpvpaper\n"
    );
}

#[test]
fn named_packages_can_use_the_catalog_or_an_explicit_system_source() {
    for (arguments, name, runner) in [
        (vec!["install", "git", "--json"], "git", "pacman"),
        (
            vec!["install", "--pacman", "not-in-catalog", "--json"],
            "not-in-catalog",
            "pacman",
        ),
        (
            vec!["install", "--aur", "aur-only", "--json"],
            "aur-only",
            "yay",
        ),
    ] {
        let sandbox = Sandbox::new();
        let result = sandbox.success(&arguments);
        assert_eq!(result["installed"], json!([name]));
        assert!(sandbox.log().starts_with(runner));
    }
}

#[test]
fn human_output_excludes_tool_progress() {
    let sandbox = Sandbox::new();
    let output = sandbox.run(&["install", "git"]);
    assert!(output.status.success(), "{output:?}");
    assert_eq!(output.stdout, b"Installed: git\n");
    assert!(String::from_utf8_lossy(&output.stderr).contains("fake pacman progress"));
}

#[test]
fn names_filter_the_requested_group() {
    let sandbox = Sandbox::new();
    let result = sandbox.success(&["install", "--main", "mpv", "--json"]);
    assert_eq!(result["installed"], json!(["mpv"]));
    assert!(!sandbox.log().contains("mpvpaper"));
}

#[test]
fn mise_tools_and_local_applications_have_separate_selectors() {
    let sandbox = Sandbox::new();
    let result = sandbox.success(&["install", "--mise", "--json"]);
    assert_eq!(result["installed"], json!(["rust@stable"]));
    assert!(sandbox.log().contains("rust@stable"));
    for selector in ["--local", "--apps"] {
        let sandbox = Sandbox::new();
        let result = sandbox.success(&["install", selector, "cli", "--json"]);
        assert_eq!(result["installed"], json!(["cli"]));
        assert_eq!(sandbox.log(), "fake-build\tcli\n");
        let link = sandbox.root.path().join("home/.local/src/cli");
        assert!(fs::symlink_metadata(&link).unwrap().is_symlink());
        assert_eq!(
            fs::canonicalize(link).unwrap(),
            sandbox.repository.join("src/ln-cli")
        );
    }
}

#[test]
fn git_packages_clone_once_and_run_the_declared_commands() {
    let sandbox = Sandbox::new();
    sandbox.git_recipe();
    for arguments in [
        vec!["install", "--git", "yay", "--json"],
        vec!["install", "yay", "--json"],
    ] {
        let result = sandbox.success(&arguments);
        assert_eq!(result["installed"], json!(["yay"]));
    }
    let checkout = sandbox.root.path().join("home/.local/src/yay");
    assert_eq!(
        fs::read_to_string(checkout.join("source.txt")).unwrap(),
        "source"
    );
    assert_eq!(
        git(&checkout, &["rev-parse", "--is-shallow-repository"]),
        "true"
    );
    assert_eq!(sandbox.log(), "fake-build\tyay\nfake-build\tyay\n");
}

#[test]
fn setup_installs_sources_in_order_and_keeps_progress_out_of_json_stdout() {
    let sandbox = Sandbox::new();
    sandbox.git_recipe();
    let config = sandbox.app_config("demo");
    write_json(
        &sandbox.repository.join("apps/demo/app.conf"),
        json!({
            "command": [["/bin/sh", "-c", "printf 'configure\\n' >> \"$FAKE_LOG\""]],
            "exports": [{"source": "file.conf", "target": "demo/file.conf"}]
        }),
    );
    let result = sandbox.success(&["setup", "--json"]);
    assert_eq!(
        result["installed"],
        json!([
            "git",
            "mpv",
            "yay",
            "mpvpaper",
            "rust@stable",
            "cli",
            "demo"
        ])
    );
    assert_eq!(fs::read_to_string(config).unwrap(), "setting = default\n");
    let log = sandbox.log();
    let pacman = log.find("pacman\t").unwrap();
    let git = log.find("fake-build\tyay").unwrap();
    let aur = log.find("yay\t-S").unwrap();
    let mise = log.find("mise\t").unwrap();
    let local = log.find("fake-build\tcli").unwrap();
    let configure = log.find("configure\n").unwrap();
    assert!(
        pacman < git && git < aur && aur < mise && mise < local && local < configure,
        "{log}"
    );
}

#[test]
fn package_installs_configure_only_matching_apps_after_success() {
    for source in ["--pacman", "--local"] {
        let sandbox = Sandbox::new();
        let package = if source == "--pacman" { "git" } else { "cli" };
        let config = sandbox.app_config("demo");
        let unrelated = sandbox.app_config("other");
        write_json(
            &sandbox.repository.join("apps/demo/app.conf"),
            json!({
                "package": package,
                "exports": [{"source": "file.conf", "target": "demo/file.conf"}]
            }),
        );
        let result = sandbox.success(&["install", source, package, "--json"]);
        assert_eq!(result["installed"], json!([package, "demo"]));
        assert_eq!(fs::read_to_string(&config).unwrap(), "setting = default\n");
        assert!(!unrelated.exists());
    }

    let sandbox = Sandbox::new();
    let config = sandbox.app_config("cli");
    let output = sandbox
        .command()
        .env("FAKE_FAIL", "fake-build")
        .args(["install", "--local", "cli", "--json"])
        .output()
        .unwrap();
    assert!(!output.status.success(), "{output:?}");
    assert!(!config.exists());
}

#[test]
fn configure_selects_apps_and_replaces_existing_files_without_installing_packages() {
    let sandbox = Sandbox::new();
    let config = sandbox.app_config("demo");
    let other_config = sandbox.app_config("other");
    let output = sandbox
        .command()
        .current_dir(sandbox.root.path())
        .args(["configure", "demo", "--json", "--repo"])
        .arg(&sandbox.repository)
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    let response: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["result"]["installed"], json!(["demo"]));
    assert_eq!(fs::read_to_string(&config).unwrap(), "setting = default\n");
    assert!(!other_config.exists());
    fs::write(&config, "# User settings\nsetting = custom\n").unwrap();
    let output = sandbox.run(&["configure", "demo"]);
    assert!(output.status.success(), "{output:?}");
    assert_eq!(output.stdout, b"Installed: demo\n");
    assert_eq!(fs::read_to_string(config).unwrap(), "setting = default\n");
    assert!(sandbox.log().is_empty());
}

#[test]
fn conflicting_sources_are_usage_errors_before_repository_lookup() {
    let sources = ["--pacman", "--aur", "--mise", "--git", "--local"];
    let mut conflicts = Vec::new();
    for (index, left) in sources.iter().enumerate() {
        for right in &sources[index + 1..] {
            conflicts.push(vec![*left, *right]);
        }
    }
    for group in ["--core", "--main"] {
        for source in ["--mise", "--git", "--local", "--apps"] {
            conflicts.push(vec![group, source]);
        }
    }
    for arguments in conflicts {
        let sandbox = Sandbox::new();
        let output = sandbox
            .command()
            .current_dir(sandbox.root.path())
            .args(["install", "--json", "--repo", "/missing/checkout"])
            .args(&arguments)
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(2), "{arguments:?}: {output:?}");
        assert!(output.stderr.is_empty(), "{output:?}");
        let response: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(response["ok"], false);
        assert!(
            response["error"]
                .as_str()
                .unwrap()
                .contains("cannot be used")
        );
        assert!(sandbox.log().is_empty());
    }
}

#[test]
fn invalid_selection_fails_without_running_package_tools() {
    for arguments in [
        vec!["install", "--json"],
        vec!["install", "unknown-name", "--json"],
        vec!["install", "--local", "unknown-app", "--json"],
        vec!["install", "--mise", "unknown-tool", "--json"],
        vec!["install", "--git", "unknown-repo", "--json"],
        vec!["install", "--core", "mpv", "--json"],
    ] {
        let sandbox = Sandbox::new();
        let output = sandbox.run(&arguments);
        assert_eq!(output.status.code(), Some(1), "{output:?}");
        let response: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(response["ok"], false);
        assert!(sandbox.log().is_empty());
    }
}

#[test]
fn explicit_repository_works_outside_the_checkout() {
    let sandbox = Sandbox::new();
    let output = sandbox
        .command()
        .current_dir(sandbox.root.path())
        .args(["install", "--repo"])
        .arg(&sandbox.repository)
        .args(["--core", "--json"])
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    let response: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["result"]["installed"], json!(["git"]));
}

#[test]
fn discovers_repository_from_environment_ancestors_and_standard_source_directory() {
    let sandbox = Sandbox::new();
    let nested = sandbox.repository.join("src/nested");
    fs::create_dir_all(&nested).unwrap();
    let output = sandbox
        .command()
        .current_dir(&nested)
        .args(["install", "git", "--json"])
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");

    let output = sandbox
        .command()
        .current_dir(sandbox.root.path())
        .env("LUNA_NEXT_ROOT", &sandbox.repository)
        .args(["install", "git", "--json"])
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");

    let location = sandbox.root.path().join("home/.local/src/luna-next");
    fs::create_dir_all(location.parent().unwrap()).unwrap();
    fs::rename(&sandbox.repository, &location).unwrap();
    let output = sandbox
        .command()
        .current_dir(sandbox.root.path())
        .args(["install", "git", "--json"])
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");

    let output = sandbox
        .command()
        .current_dir(sandbox.root.path())
        .env("LUNA_NEXT_ROOT", sandbox.root.path().join("missing"))
        .args(["install", "git", "--json"])
        .output()
        .unwrap();
    assert!(!output.status.success(), "{output:?}");
    assert_eq!(sandbox.log().lines().count(), 3);
}

#[test]
fn package_failures_return_one_error_response_and_stop() {
    for (tool, commands) in [("pacman", 1), ("fake-build", 4)] {
        let sandbox = Sandbox::new();
        let config = sandbox.app_config("demo");
        let output = sandbox
            .command()
            .env("FAKE_FAIL", tool)
            .args(["setup", "--json"])
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(1), "{output:?}");
        let response: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(response["ok"], false);
        assert_eq!(sandbox.log().lines().count(), commands);
        assert!(!config.exists());
    }
}

#[test]
fn help_lists_install_selectors_and_no_build_command() {
    let sandbox = Sandbox::new();
    let output = sandbox.run(&["--help"]);
    assert!(output.status.success());
    let help = String::from_utf8(output.stdout).unwrap();
    assert!(help.contains("install"));
    assert!(help.contains("configure"));
    assert!(help.contains("setup"));
    assert!(
        !help
            .lines()
            .any(|line| line.trim_start().starts_with("build "))
    );
    let output = sandbox.run(&["install", "--help"]);
    assert!(output.status.success());
    let help = String::from_utf8(output.stdout).unwrap();
    for selector in [
        "--core", "--main", "--mise", "--git", "--local", "--aur", "--pacman", "--apps",
    ] {
        assert!(help.contains(selector), "{help}");
    }
    assert!(sandbox.log().is_empty());
}
