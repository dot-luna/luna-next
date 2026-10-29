use std::{
    fs,
    os::unix::fs::symlink,
    path::{Path, PathBuf},
    process::Command,
};

use luna_next::install::{Package, Source, install, install_via_local};

fn scenario(name: &str) {
    let temporary = tempfile::Builder::new()
        .prefix("luna local test '")
        .tempdir()
        .unwrap();
    let home = temporary.path().join("home");
    let workspace = temporary.path().join("workspace");
    fs::create_dir(&home).unwrap();
    fs::create_dir(&workspace).unwrap();
    let output = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "local_scenario", "--nocapture"])
        .env("LUNA_LOCAL_TEST_ROOT", temporary.path())
        .env("LUNA_LOCAL_TEST_SCENARIO", name)
        .env("HOME", &home)
        .env("PATH", "")
        .current_dir(&workspace)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{name}:\n{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

struct Fixture {
    root: PathBuf,
    source: PathBuf,
    local: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let root = PathBuf::from(std::env::var_os("LUNA_LOCAL_TEST_ROOT").unwrap());
        let source = root.join("workspace/source directory");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("source.txt"), "original").unwrap();
        let local = root.join("home/.local");
        Self {
            root,
            source,
            local,
        }
    }

    fn package(&self, name: &str) -> Package {
        Package {
            name: name.into(),
            source: Source::Local,
            url: Some(self.source.to_str().unwrap().into()),
            ..Package::default()
        }
    }

    fn link(&self, name: &str) -> PathBuf {
        self.local.join("src").join(name)
    }

    fn assert_source_link(&self, link: &Path) {
        assert!(fs::symlink_metadata(link).unwrap().is_symlink());
        assert_eq!(fs::canonicalize(link).unwrap(), self.source);
    }
}

#[test]
fn local_install_links_relative_sources_and_runs_commands_with_literal_arguments() {
    scenario("link_and_command");
}

#[test]
fn local_install_can_link_into_share_without_build_commands() {
    scenario("share");
}

#[test]
fn repeated_local_install_reuses_the_link_and_runs_commands_again() {
    scenario("repeat");
}

#[test]
fn existing_directories_and_conflicting_symlinks_are_replaced_without_touching_link_targets() {
    scenario("replace");
}

#[test]
fn existing_regular_files_are_preserved_without_running_commands() {
    scenario("existing_file");
}

#[test]
fn invalid_local_package_definitions_fail_before_linking_or_running_commands() {
    scenario("validation");
}

#[test]
fn a_failed_local_command_stops_later_commands_and_packages() {
    scenario("failure");
}

#[test]
fn an_empty_local_package_list_does_not_create_directories() {
    scenario("empty");
}

#[test]
fn destinations_at_or_inside_the_source_are_rejected_before_other_installs() {
    scenario("inside_source");
}

#[test]
fn destinations_containing_the_source_are_rejected_before_other_installs() {
    scenario("contains_source");
}

#[test]
fn replacing_a_destination_cannot_delete_another_packages_source() {
    scenario("contains_other_source");
}

#[test]
fn overlapping_local_destinations_are_rejected_before_creating_directories() {
    scenario("overlapping");
}

#[test]
fn a_destination_parent_symlink_cannot_escape_the_local_root() {
    scenario("escaping_parent");
}

#[test]
fn the_local_root_itself_can_be_a_symlink() {
    scenario("linked_root");
}

#[test]
fn local_scenario() {
    let Ok(scenario) = std::env::var("LUNA_LOCAL_TEST_SCENARIO") else {
        return;
    };
    let fixture = Fixture::new();
    match scenario.as_str() {
        "link_and_command" => {
            let mut package = fixture.package("sample");
            package.url = Some("source directory".into());
            package.command = vec![vec![
                "/bin/sh".into(),
                "-c".into(),
                "pwd -P > build.cwd; printf '%s' \"$1\" > argument.txt".into(),
                "--".into(),
                "literal argument ; $(printf unexpected)".into(),
            ]];
            let report = install(Source::Local, &[package]).unwrap();
            assert_eq!(report.installed, ["sample"]);
            assert!(report.skipped.is_empty());
            fixture.assert_source_link(&fixture.link("sample"));
            assert_eq!(
                fs::read_to_string(fixture.source.join("build.cwd"))
                    .unwrap()
                    .trim(),
                fixture.source.to_str().unwrap()
            );
            assert_eq!(
                fs::read_to_string(fixture.source.join("argument.txt")).unwrap(),
                "literal argument ; $(printf unexpected)"
            );
            fs::write(fixture.source.join("source.txt"), "updated").unwrap();
            assert_eq!(
                fs::read_to_string(fixture.link("sample").join("source.txt")).unwrap(),
                "updated"
            );
        }
        "share" => {
            let mut package = fixture.package("wallpaper");
            package.destination = Some("share/luna-next/wallpaper".into());
            let report = install_via_local(&[package]).unwrap();
            assert_eq!(report.installed, ["wallpaper"]);
            fixture.assert_source_link(&fixture.local.join("share/luna-next/wallpaper"));
            assert!(!fixture.local.join("src").exists());
        }
        "repeat" => {
            let mut package = fixture.package("sample");
            package.command = vec![vec![
                "/bin/sh".into(),
                "-c".into(),
                "printf 'built\\n' >> build.log".into(),
            ]];
            install_via_local(&[package.clone()]).unwrap();
            let original = fs::read_link(fixture.link("sample")).unwrap();
            install_via_local(&[package]).unwrap();
            fixture.assert_source_link(&fixture.link("sample"));
            assert_eq!(fs::read_link(fixture.link("sample")).unwrap(), original);
            assert_eq!(
                fs::read_to_string(fixture.source.join("build.log")).unwrap(),
                "built\nbuilt\n"
            );
        }
        "replace" => {
            fs::create_dir_all(fixture.local.join("src")).unwrap();
            let directory = fixture.link("directory");
            fs::create_dir_all(directory.join("nested")).unwrap();
            fs::write(directory.join("nested/old.txt"), "old directory").unwrap();
            let other_source = fixture.root.join("other source");
            fs::create_dir(&other_source).unwrap();
            fs::write(other_source.join("keep.txt"), "keep other source").unwrap();
            symlink(&other_source, directory.join("nested/link")).unwrap();
            let other_link = fixture.link("other-link");
            symlink(&other_source, &other_link).unwrap();
            let missing_source = fixture.root.join("missing source");
            let broken_link = fixture.link("broken-link");
            symlink(&missing_source, &broken_link).unwrap();
            for name in ["directory", "other-link", "broken-link"] {
                let mut package = fixture.package(name);
                package.command = vec![vec![
                    "/bin/sh".into(),
                    "-c".into(),
                    format!("printf '{name}\\n' >> build.log"),
                ]];
                let report = install_via_local(&[package]).unwrap();
                assert_eq!(report.installed, [name]);
                fixture.assert_source_link(&fixture.link(name));
            }
            assert!(!directory.join("nested").exists());
            assert_eq!(
                fs::read_to_string(other_source.join("keep.txt")).unwrap(),
                "keep other source"
            );
            assert!(!missing_source.exists());
            assert_eq!(
                fs::read_to_string(fixture.source.join("build.log")).unwrap(),
                "directory\nother-link\nbroken-link\n"
            );
        }
        "existing_file" => {
            fs::create_dir_all(fixture.local.join("src")).unwrap();
            let file = fixture.link("sample");
            fs::write(&file, "keep file").unwrap();
            let mut package = fixture.package("sample");
            package.command = vec![vec!["/bin/sh".into(), "-c".into(), ": > unexpected".into()]];
            assert!(install_via_local(&[package]).is_err());
            assert_eq!(fs::read_to_string(file).unwrap(), "keep file");
            assert!(!fixture.source.join("unexpected").exists());
        }
        "validation" => {
            let mut valid = fixture.package("valid");
            valid.command = vec![vec!["/bin/sh".into(), "-c".into(), ": > unexpected".into()]];
            let mut invalid_packages = Vec::new();
            for name in ["../outside", "-option"] {
                invalid_packages.push(fixture.package(name));
            }
            for url in [
                None,
                Some("".into()),
                Some("  ".into()),
                Some("missing source".into()),
                Some(fixture.source.join("source.txt").to_str().unwrap().into()),
            ] {
                let mut package = fixture.package("invalid");
                package.url = url;
                invalid_packages.push(package);
            }
            for command in [
                vec![],
                vec![" ".into()],
                vec!["/bin/sh".into(), "\0".into()],
            ] {
                let mut package = fixture.package("invalid");
                package.command = vec![command];
                invalid_packages.push(package);
            }
            let mut version = fixture.package("invalid");
            version.version = Some("latest".into());
            invalid_packages.push(version);
            for destination in [PathBuf::from("../outside"), fixture.root.join("absolute")] {
                let mut package = fixture.package("invalid");
                package.destination = Some(destination);
                invalid_packages.push(package);
            }
            for invalid in invalid_packages {
                assert!(install(Source::Local, &[valid.clone(), invalid]).is_err());
                assert!(!fixture.local.exists());
                assert!(!fixture.source.join("unexpected").exists());
            }
        }
        "failure" => {
            let mut failed = fixture.package("failed");
            failed.command = vec![
                vec!["/bin/sh".into(), "-c".into(), "exit 23".into()],
                vec!["/bin/sh".into(), "-c".into(), ": > unexpected".into()],
            ];
            let error = install_via_local(&[failed, fixture.package("later")]).unwrap_err();
            assert!(error.to_string().contains("23"), "{error}");
            fixture.assert_source_link(&fixture.link("failed"));
            assert!(!fixture.source.join("unexpected").exists());
            assert!(!fixture.link("later").exists());
        }
        "empty" => {
            let report = install(Source::Local, &[]).unwrap();
            assert!(report.installed.is_empty());
            assert!(report.skipped.is_empty());
            assert!(!fixture.local.exists());
        }
        "inside_source" => {
            let source = fixture.local.join("source");
            fs::create_dir_all(&source).unwrap();
            fs::write(source.join("keep.txt"), "keep source").unwrap();
            for destination in ["source", "source/build/sample"] {
                let mut package = fixture.package("sample");
                package.url = Some(source.to_str().unwrap().into());
                package.destination = Some(destination.into());
                assert!(
                    install_via_local(&[fixture.package("first"), package]).is_err(),
                    "{destination}"
                );
                assert!(!fixture.local.join("src").exists());
                assert!(!source.join("build").exists());
                assert_eq!(
                    fs::read_to_string(source.join("keep.txt")).unwrap(),
                    "keep source"
                );
                assert!(!fs::symlink_metadata(&source).unwrap().is_symlink());
            }
        }
        "contains_source" => {
            let directory = fixture.local.join("share/sample");
            let source = directory.join("nested/source");
            fs::create_dir_all(&source).unwrap();
            fs::write(source.join("keep.txt"), "keep source").unwrap();
            let mut package = fixture.package("sample");
            package.url = Some(source.to_str().unwrap().into());
            package.destination = Some("share/sample".into());
            assert!(install_via_local(&[fixture.package("first"), package]).is_err());
            assert!(!fixture.local.join("src").exists());
            assert!(!fs::symlink_metadata(&directory).unwrap().is_symlink());
            assert_eq!(
                fs::read_to_string(source.join("keep.txt")).unwrap(),
                "keep source"
            );
        }
        "contains_other_source" => {
            let directory = fixture.local.join("share/first");
            let source = directory.join("nested/second-source");
            fs::create_dir_all(&source).unwrap();
            fs::write(source.join("keep.txt"), "keep other source").unwrap();
            let mut first = fixture.package("first");
            first.destination = Some("share/first".into());
            first.command = vec![vec!["/bin/sh".into(), "-c".into(), ": > unexpected".into()]];
            let mut second = fixture.package("second");
            second.url = Some(source.to_str().unwrap().into());
            for packages in [
                [first.clone(), second.clone()],
                [second.clone(), first.clone()],
            ] {
                assert!(install_via_local(&packages).is_err());
                assert!(!fixture.local.join("src").exists());
                assert!(!fs::symlink_metadata(&directory).unwrap().is_symlink());
                assert!(!fixture.source.join("unexpected").exists());
                assert_eq!(
                    fs::read_to_string(source.join("keep.txt")).unwrap(),
                    "keep other source"
                );
            }
        }
        "overlapping" => {
            for (first, second) in [
                ("share/sample", "share/sample/nested"),
                ("share/sample/nested", "share/sample"),
                ("share/sample", "share/sample"),
            ] {
                let mut first_package = fixture.package("first");
                first_package.destination = Some(first.into());
                let mut second_package = fixture.package("second");
                second_package.destination = Some(second.into());
                assert!(install_via_local(&[first_package, second_package]).is_err());
                assert!(!fixture.local.exists());
            }
        }
        "escaping_parent" => {
            let outside = fixture.root.join("outside");
            fs::create_dir(&outside).unwrap();
            fs::write(outside.join("keep.txt"), "keep outside").unwrap();
            fs::create_dir(&fixture.local).unwrap();
            let parent = fixture.local.join("share");
            symlink(&outside, &parent).unwrap();
            let mut package = fixture.package("sample");
            package.destination = Some("share/luna-next/sample".into());
            assert!(install_via_local(&[fixture.package("first"), package]).is_err());
            assert_eq!(fs::read_link(parent).unwrap(), outside);
            assert!(!fixture.local.join("src").exists());
            assert!(!outside.join("luna-next").exists());
            assert_eq!(
                fs::read_to_string(outside.join("keep.txt")).unwrap(),
                "keep outside"
            );
        }
        "linked_root" => {
            let actual_root = fixture.root.join("actual-local");
            fs::create_dir(&actual_root).unwrap();
            symlink(&actual_root, &fixture.local).unwrap();
            let report = install_via_local(&[fixture.package("sample")]).unwrap();
            assert_eq!(report.installed, ["sample"]);
            assert_eq!(fs::read_link(&fixture.local).unwrap(), actual_root);
            fixture.assert_source_link(&fixture.link("sample"));
            fixture.assert_source_link(&actual_root.join("src/sample"));
        }
        _ => panic!("unknown local install scenario: {scenario}"),
    }
}
