use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
};

use luna_next::install::{Package, Source, install, install_via_git};

fn scenario(name: &str) {
    let temp = tempfile::Builder::new()
        .prefix("luna git test '")
        .tempdir()
        .unwrap();
    let home = temp.path().join("home");
    fs::create_dir(&home).unwrap();
    let mut child = Command::new(std::env::current_exe().unwrap());
    child
        .args(["--exact", "git_scenario", "--nocapture"])
        .env("LUNA_GIT_TEST_ROOT", temp.path())
        .env("LUNA_GIT_TEST_SCENARIO", name)
        .env("HOME", &home)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_ALLOW_PROTOCOL", "file")
        .env("GIT_AUTHOR_NAME", "Luna Test")
        .env("GIT_AUTHOR_EMAIL", "luna-test@example.invalid")
        .env("GIT_COMMITTER_NAME", "Luna Test")
        .env("GIT_COMMITTER_EMAIL", "luna-test@example.invalid");
    for key in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_COMMON_DIR",
        "GIT_CONFIG",
        "GIT_CONFIG_COUNT",
        "GIT_CONFIG_PARAMETERS",
    ] {
        child.env_remove(key);
    }
    let output = child.output().unwrap();
    assert!(
        output.status.success(),
        "{name}:\n{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn git(path: &Path, arguments: &[&str]) -> String {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(arguments)
        .output()
        .unwrap();
    assert_success(&output);
    String::from_utf8(output.stdout).unwrap().trim().into()
}

fn assert_success(output: &Output) {
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

struct Fixture {
    root: PathBuf,
    remote: PathBuf,
    checkout: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let root = PathBuf::from(std::env::var_os("LUNA_GIT_TEST_ROOT").unwrap());
        let remote = root.join("remote source");
        fs::create_dir(&remote).unwrap();
        git(&remote, &["init", "--initial-branch=main"]);
        let checkout = root.join("home/.local/src/sample");
        let fixture = Self {
            root,
            remote,
            checkout,
        };
        fixture.commit("first");
        fixture
    }

    fn commit(&self, value: &str) -> String {
        fs::write(self.remote.join("source.txt"), value).unwrap();
        git(&self.remote, &["add", "source.txt"]);
        git(&self.remote, &["commit", "--message", value]);
        git(&self.remote, &["rev-parse", "HEAD"])
    }

    fn package(&self, version: Option<&str>) -> Package {
        Package {
            name: "sample".into(),
            source: Source::Git,
            url: Some(
                url::Url::from_directory_path(&self.remote)
                    .unwrap()
                    .to_string(),
            ),
            version: version.map(str::to_owned),
            git_include_prereleases: false,
            git_release_tag_pattern: None,
            destination: None,
            command: vec![vec![
                "/bin/sh".into(),
                "-c".into(),
                "pwd > build.cwd; printf 'built\\n' >> build.log".into(),
            ]],
        }
    }

    fn install(&self, version: Option<&str>) {
        let report = install(Source::Git, &[self.package(version)]).unwrap();
        assert_eq!(report.installed, ["sample"]);
    }

    fn contents(&self) -> String {
        fs::read_to_string(self.checkout.join("source.txt")).unwrap()
    }

    fn assert_shallow(&self) {
        assert_eq!(
            git(&self.checkout, &["rev-parse", "--is-shallow-repository"]),
            "true"
        );
    }
}

#[test]
fn shallow_clone_runs_commands_in_the_checkout_without_shell_argument_expansion() {
    scenario("clone");
}

#[test]
fn repeated_install_pulls_new_commits_and_keeps_untracked_build_outputs() {
    scenario("update");
}

#[test]
fn requested_branch_is_checked_out_and_updated() {
    scenario("branch");
}

#[test]
fn requested_tag_stays_pinned_when_the_default_branch_advances() {
    scenario("tag");
}

#[test]
fn latest_selects_the_highest_version_tag_and_updates_to_new_tags() {
    scenario("latest");
}

#[test]
fn latest_with_prereleases_orders_numeric_identifiers_and_updates_to_new_nightlies() {
    scenario("prerelease");
}

#[test]
fn latest_prefers_a_stable_release_over_prereleases_of_the_same_version() {
    scenario("stable_precedence");
}

#[test]
fn latest_with_only_prerelease_tags_requires_explicit_opt_in_before_cloning() {
    scenario("prerelease_only");
}

#[test]
fn latest_accepts_non_semver_tags_and_can_select_a_tag_namespace() {
    scenario("non_semver_tags");
}

#[test]
fn latest_with_no_tags_matching_the_pattern_fails_before_cloning() {
    scenario("unmatched_pattern");
}

#[test]
fn latest_without_tags_uses_and_updates_the_default_branch() {
    scenario("no_tags");
}

#[test]
fn latest_uses_the_tag_when_a_branch_has_the_same_name() {
    scenario("tag_branch_collision");
}

#[test]
fn failed_command_stops_later_commands_and_packages() {
    scenario("failure");
}

#[test]
fn invalid_package_definitions_fail_before_cloning_any_packages() {
    scenario("validation");
}

#[test]
fn existing_non_repository_paths_and_symlinks_are_preserved() {
    scenario("existing_path");
}

#[test]
fn an_existing_repository_with_a_different_origin_is_preserved() {
    scenario("origin");
}

#[test]
fn tracked_local_changes_are_preserved_without_running_build_commands() {
    scenario("local_changes");
}

#[test]
fn local_commits_in_a_detached_checkout_are_preserved_without_running_build_commands() {
    scenario("detached_commit");
}

#[test]
fn git_scenario() {
    if std::env::var_os("LUNA_GIT_TEST_ROOT").is_none() {
        return;
    }
    let fixture = Fixture::new();
    match std::env::var("LUNA_GIT_TEST_SCENARIO").unwrap().as_str() {
        "clone" => {
            fixture.commit("second");
            let expected = fixture.commit("third");
            let mut package = fixture.package(None);
            package.command.push(vec![
                "/bin/sh".into(),
                "-c".into(),
                "printf '%s' \"$1\" > argument.txt".into(),
                "--".into(),
                "literal argument ; $(touch unexpected)".into(),
            ]);
            install_via_git(&[package]).unwrap();
            fixture.assert_shallow();
            assert_eq!(
                git(&fixture.checkout, &["rev-list", "--count", "HEAD"]),
                "1"
            );
            assert_eq!(git(&fixture.checkout, &["rev-parse", "HEAD"]), expected);
            assert_eq!(
                fs::read_to_string(fixture.checkout.join("build.cwd"))
                    .unwrap()
                    .trim(),
                fixture.checkout.to_str().unwrap()
            );
            assert_eq!(
                fs::read_to_string(fixture.checkout.join("argument.txt")).unwrap(),
                "literal argument ; $(touch unexpected)"
            );
            assert!(!fixture.checkout.join("unexpected").exists());
        }
        "update" => {
            fixture.install(None);
            fs::write(fixture.checkout.join("keep.txt"), "keep").unwrap();
            let expected = fixture.commit("updated");
            fixture.install(None);
            fixture.install(None);
            assert_eq!(fixture.contents(), "updated");
            assert_eq!(git(&fixture.checkout, &["rev-parse", "HEAD"]), expected);
            assert_eq!(
                fs::read_to_string(fixture.checkout.join("build.log")).unwrap(),
                "built\nbuilt\nbuilt\n"
            );
            assert_eq!(
                fs::read_to_string(fixture.checkout.join("keep.txt")).unwrap(),
                "keep"
            );
            fixture.assert_shallow();
        }
        "branch" => {
            git(&fixture.remote, &["checkout", "-b", "feature/test"]);
            fixture.commit("feature");
            git(&fixture.remote, &["checkout", "main"]);
            let mut package = fixture.package(Some("feature/test"));
            package.git_release_tag_pattern = Some("release/*".into());
            install_via_git(&[package.clone()]).unwrap();
            assert_eq!(fixture.contents(), "feature");
            assert_eq!(
                git(&fixture.checkout, &["branch", "--show-current"]),
                "feature/test"
            );
            git(&fixture.remote, &["checkout", "feature/test"]);
            fixture.commit("feature updated");
            install_via_git(&[package]).unwrap();
            assert_eq!(fixture.contents(), "feature updated");
            fixture.assert_shallow();
        }
        "tag" => {
            git(&fixture.remote, &["tag", "v1.0.0-rc.1"]);
            fixture.commit("new default");
            let mut package = fixture.package(Some("v1.0.0-rc.1"));
            package.git_release_tag_pattern = Some("release/*".into());
            install_via_git(&[package.clone()]).unwrap();
            assert_eq!(fixture.contents(), "first");
            assert_eq!(git(&fixture.checkout, &["branch", "--show-current"]), "");
            fixture.commit("newer default");
            install_via_git(&[package]).unwrap();
            assert_eq!(fixture.contents(), "first");
            fixture.assert_shallow();
        }
        "latest" => {
            let mut package = fixture.package(Some("latest"));
            package.git_release_tag_pattern = Some("v[0-9]*".into());
            git(&fixture.remote, &["tag", "v1"]);
            fixture.commit("untagged after version one");
            install_via_git(&[package.clone()]).unwrap();
            assert_eq!(fixture.contents(), "first");
            fixture.commit("version nine");
            git(&fixture.remote, &["tag", "v1.9"]);
            install_via_git(&[package.clone()]).unwrap();
            assert_eq!(fixture.contents(), "version nine");
            fixture.commit("version ten");
            git(&fixture.remote, &["tag", "v1.10"]);
            fixture.commit("future prerelease");
            git(&fixture.remote, &["tag", "v2.0.0-nightly.10"]);
            fixture.commit("non-version tag");
            git(&fixture.remote, &["tag", "android-beta"]);
            fixture.commit("untagged");
            install_via_git(&[package.clone()]).unwrap();
            assert_eq!(fixture.contents(), "version ten");
            fixture.commit("version eleven");
            git(
                &fixture.remote,
                &["tag", "--annotate", "v1.11", "--message", "release"],
            );
            install_via_git(&[package.clone()]).unwrap();
            assert_eq!(fixture.contents(), "version eleven");
            install_via_git(&[package]).unwrap();
            assert_eq!(fixture.contents(), "version eleven");
            fixture.assert_shallow();
        }
        "prerelease" => {
            git(&fixture.remote, &["tag", "v1.0.0"]);
            fixture.commit("nightly ten");
            git(&fixture.remote, &["tag", "v2.0.0-nightly.10"]);
            fixture.commit("nightly nine");
            git(&fixture.remote, &["tag", "v2.0.0-nightly.9"]);
            fixture.commit("non-version tag");
            git(&fixture.remote, &["tag", "android-beta"]);
            fixture.commit("untagged");
            let mut package = fixture.package(Some("latest"));
            package.git_include_prereleases = true;
            package.git_release_tag_pattern = Some("v[0-9]*".into());
            package.command.push(vec![
                "/bin/sh".into(),
                "-c".into(),
                "printf '%s' \"$LUNA_PACKAGE_VERSION\" > selected-version.txt".into(),
            ]);
            install_via_git(&[package.clone()]).unwrap();
            assert_eq!(fixture.contents(), "nightly ten");
            assert_eq!(
                fs::read_to_string(fixture.checkout.join("selected-version.txt")).unwrap(),
                "v2.0.0-nightly.10"
            );
            fixture.commit("nightly eleven");
            git(&fixture.remote, &["tag", "v2.0.0-nightly.11"]);
            fixture.commit("newer default");
            install_via_git(&[package.clone()]).unwrap();
            install_via_git(&[package]).unwrap();
            assert_eq!(fixture.contents(), "nightly eleven");
            assert_eq!(
                fs::read_to_string(fixture.checkout.join("selected-version.txt")).unwrap(),
                "v2.0.0-nightly.11"
            );
            assert_eq!(
                fs::read_to_string(fixture.checkout.join("build.log")).unwrap(),
                "built\nbuilt\nbuilt\n"
            );
            fixture.assert_shallow();
        }
        "stable_precedence" => {
            git(&fixture.remote, &["tag", "v2.0.0"]);
            fixture.commit("nightly");
            git(&fixture.remote, &["tag", "v2.0.0-nightly.100"]);
            fixture.commit("release candidate");
            git(&fixture.remote, &["tag", "v2.0.0-rc.1"]);
            fixture.install(Some("latest"));
            assert_eq!(fixture.contents(), "first");
            let mut package = fixture.package(Some("latest"));
            package.git_include_prereleases = true;
            install_via_git(&[package]).unwrap();
            assert_eq!(fixture.contents(), "first");
            fixture.assert_shallow();
        }
        "prerelease_only" => {
            git(&fixture.remote, &["tag", "v2.0.0-nightly.1"]);
            fixture.commit("release candidate");
            git(&fixture.remote, &["tag", "v2.0.0-rc.1"]);
            fixture.commit("untagged default");
            let mut package = fixture.package(Some("latest"));
            let error = install_via_git(&[package.clone()]).unwrap_err();
            let message = error.to_string();
            assert!(message.contains("tag"), "{message}");
            assert!(
                message.contains("stable") || message.contains("prerelease"),
                "{message}"
            );
            assert!(!fixture.checkout.exists());

            package.git_include_prereleases = true;
            install_via_git(&[package.clone()]).unwrap();
            assert_eq!(fixture.contents(), "release candidate");
            package.git_include_prereleases = false;
            assert!(install_via_git(&[package]).is_err());
            assert_eq!(fixture.contents(), "release candidate");
            assert_eq!(
                fs::read_to_string(fixture.checkout.join("build.log")).unwrap(),
                "built\n"
            );
        }
        "non_semver_tags" => {
            git(&fixture.remote, &["tag", "android-beta"]);
            fixture.commit("untagged default");
            fixture.install(Some("latest"));
            assert_eq!(fixture.contents(), "first");
            fixture.commit("release nine");
            git(&fixture.remote, &["tag", "release/9"]);
            fixture.commit("release ten");
            git(&fixture.remote, &["tag", "release/10"]);
            fixture.commit("unrelated tag");
            git(&fixture.remote, &["tag", "zzz-unrelated"]);
            fixture.install(Some("latest"));
            assert_eq!(fixture.contents(), "unrelated tag");

            let mut package = fixture.package(Some("latest"));
            package.git_release_tag_pattern = Some("release/*".into());
            install_via_git(&[package]).unwrap();
            assert_eq!(fixture.contents(), "release ten");
            fixture.assert_shallow();
        }
        "unmatched_pattern" => {
            let mut package = fixture.package(Some("latest"));
            package.git_release_tag_pattern = Some("release/*".into());
            let error = install_via_git(&[package.clone()]).unwrap_err();
            assert!(error.to_string().contains("tag"), "{error}");
            assert!(error.to_string().contains("release/*"), "{error}");
            assert!(!fixture.checkout.exists());

            git(&fixture.remote, &["tag", "android-beta"]);
            fixture.commit("untagged default");
            package.git_include_prereleases = true;
            let error = install_via_git(&[package]).unwrap_err();
            assert!(error.to_string().contains("tag"), "{error}");
            assert!(error.to_string().contains("release/*"), "{error}");
            assert!(!fixture.checkout.exists());
        }
        "no_tags" => {
            fixture.install(Some("latest"));
            assert_eq!(fixture.contents(), "first");
            fixture.commit("new default");
            fixture.install(Some("latest"));
            assert_eq!(fixture.contents(), "new default");
            fixture.assert_shallow();
        }
        "tag_branch_collision" => {
            let release = git(&fixture.remote, &["rev-parse", "HEAD"]);
            git(&fixture.remote, &["tag", "v1.0"]);
            fixture.commit("branch contents");
            git(&fixture.remote, &["branch", "v1.0"]);
            fixture.install(Some("latest"));
            fixture.install(Some("latest"));
            assert_eq!(fixture.contents(), "first");
            assert_eq!(git(&fixture.checkout, &["rev-parse", "HEAD"]), release);
            assert_eq!(git(&fixture.checkout, &["branch", "--show-current"]), "");
            assert_eq!(
                fs::read_to_string(fixture.checkout.join("build.log")).unwrap(),
                "built\nbuilt\n"
            );
            fixture.assert_shallow();

            let mut package = fixture.package(None);
            package.name = "from-default".into();
            install_via_git(&[package.clone()]).unwrap();
            package.version = Some("latest".into());
            install_via_git(&[package]).unwrap();
            let checkout = fixture.checkout.with_file_name("from-default");
            assert_eq!(
                fs::read_to_string(checkout.join("source.txt")).unwrap(),
                "first"
            );
            assert_eq!(git(&checkout, &["rev-parse", "HEAD"]), release);
            assert_eq!(git(&checkout, &["branch", "--show-current"]), "");
            assert_eq!(
                fs::read_to_string(checkout.join("build.log")).unwrap(),
                "built\nbuilt\n"
            );
        }
        "failure" => {
            let mut package = fixture.package(None);
            package.command.extend([
                vec!["/bin/sh".into(), "-c".into(), "exit 17".into()],
                vec!["/bin/sh".into(), "-c".into(), "touch too-late".into()],
            ]);
            let mut later = fixture.package(None);
            later.name = "later".into();
            let error = install_via_git(&[package, later]).unwrap_err();
            assert!(error.to_string().contains("17"), "{error}");
            assert!(fixture.checkout.join("build.log").exists());
            assert!(!fixture.checkout.join("too-late").exists());
            assert!(!fixture.checkout.with_file_name("later").exists());
        }
        "validation" => {
            let mut invalid = Vec::new();
            for name in [
                "",
                ".",
                "..",
                "../outside",
                "/absolute",
                "part/name",
                "-bad",
            ] {
                let mut package = fixture.package(None);
                package.name = name.into();
                invalid.push(package);
            }
            for url in ["", "file:///invalid\0url"] {
                let mut package = fixture.package(None);
                package.url = Some(url.into());
                invalid.push(package);
            }
            let mut package = fixture.package(None);
            package.url = None;
            invalid.push(package);
            for command in [
                Vec::new(),
                vec![Vec::new()],
                vec![vec!["".into()]],
                vec![vec!["/bin/echo".into(), "invalid\0argument".into()]],
            ] {
                let mut package = fixture.package(None);
                package.command = command;
                invalid.push(package);
            }
            for package in invalid {
                let description = format!("{package:?}");
                assert!(
                    install_via_git(&[fixture.package(None), package]).is_err(),
                    "{description}"
                );
                assert!(!fixture.checkout.exists(), "{description}");
            }
        }
        "existing_path" => {
            fs::create_dir_all(&fixture.checkout).unwrap();
            fs::write(fixture.checkout.join("keep.txt"), "keep").unwrap();
            assert!(install_via_git(&[fixture.package(None)]).is_err());
            assert_eq!(
                fs::read_to_string(fixture.checkout.join("keep.txt")).unwrap(),
                "keep"
            );
            fs::remove_dir_all(&fixture.checkout).unwrap();
            fs::write(&fixture.checkout, "existing file").unwrap();
            assert!(install_via_git(&[fixture.package(None)]).is_err());
            assert_eq!(
                fs::read_to_string(&fixture.checkout).unwrap(),
                "existing file"
            );
            fs::remove_file(&fixture.checkout).unwrap();
            let outside = fixture.root.join("outside");
            fs::create_dir(&outside).unwrap();
            std::os::unix::fs::symlink(&outside, &fixture.checkout).unwrap();
            assert!(install_via_git(&[fixture.package(None)]).is_err());
            assert!(fixture.checkout.is_symlink());
            assert_eq!(fs::read_dir(outside).unwrap().count(), 0);
        }
        "origin" => {
            fixture.install(None);
            let head = git(&fixture.checkout, &["rev-parse", "HEAD"]);
            let mut package = fixture.package(None);
            package.url = Some(
                url::Url::from_directory_path(fixture.root.join("other"))
                    .unwrap()
                    .to_string(),
            );
            assert!(install_via_git(&[package]).is_err());
            assert_eq!(git(&fixture.checkout, &["rev-parse", "HEAD"]), head);
            assert_eq!(
                fs::read_to_string(fixture.checkout.join("build.log")).unwrap(),
                "built\n"
            );
        }
        "local_changes" => {
            fixture.install(None);
            let head = git(&fixture.checkout, &["rev-parse", "HEAD"]);
            fs::write(fixture.checkout.join("source.txt"), "user changes").unwrap();
            fixture.commit("remote changes");
            assert!(install_via_git(&[fixture.package(None)]).is_err());
            assert_eq!(fixture.contents(), "user changes");
            assert_eq!(git(&fixture.checkout, &["rev-parse", "HEAD"]), head);
            assert_eq!(
                fs::read_to_string(fixture.checkout.join("build.log")).unwrap(),
                "built\n"
            );
        }
        "detached_commit" => {
            git(&fixture.remote, &["tag", "v1.0"]);
            fixture.install(Some("v1.0"));
            fs::write(fixture.checkout.join("user.txt"), "committed user data").unwrap();
            git(&fixture.checkout, &["add", "user.txt"]);
            git(
                &fixture.checkout,
                &["commit", "--message", "local user commit"],
            );
            let head = git(&fixture.checkout, &["rev-parse", "HEAD"]);
            assert_eq!(git(&fixture.checkout, &["branch", "--show-current"]), "");
            assert!(install_via_git(&[fixture.package(Some("v1.0"))]).is_err());
            assert_eq!(git(&fixture.checkout, &["rev-parse", "HEAD"]), head);
            assert_eq!(
                fs::read_to_string(fixture.checkout.join("user.txt")).unwrap(),
                "committed user data"
            );
            assert_eq!(
                fs::read_to_string(fixture.checkout.join("build.log")).unwrap(),
                "built\n"
            );
        }
        other => panic!("unknown Git scenario: {other}"),
    }
}
