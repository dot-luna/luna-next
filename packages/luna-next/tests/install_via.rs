use std::{fs, os::unix::fs::PermissionsExt, path::PathBuf, process::Command};

use luna_next::install::{Package, Source, install};

fn package(name: &str, version: Option<&str>) -> Package {
    Package {
        name: name.into(),
        version: version.map(str::to_owned),
        ..Package::default()
    }
}

fn scenario(name: &str) {
    let temporary = tempfile::tempdir().unwrap();
    let home = temporary.path().join("home");
    let bin = temporary.path().join("bin");
    fs::create_dir(&home).unwrap();
    fs::create_dir(&bin).unwrap();
    for name in ["sudo", "yay", "mise"] {
        let executable = bin.join(name);
        fs::write(
            &executable,
            "#!/bin/sh\nprintf '%s\\n' \"${0##*/}\" \"$@\" >> \"$LUNA_INSTALL_TEST_LOG\"\n",
        )
        .unwrap();
        fs::set_permissions(executable, fs::Permissions::from_mode(0o755)).unwrap();
    }
    let output = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "install_scenario", "--nocapture"])
        .env("HOME", home)
        .env("PATH", bin)
        .env("LUNA_INSTALL_TEST_SCENARIO", name)
        .env("LUNA_INSTALL_TEST_LOG", temporary.path().join("commands"))
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{name}:\n{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn recorded_arguments() -> Vec<String> {
    fs::read_to_string(std::env::var_os("LUNA_INSTALL_TEST_LOG").unwrap())
        .unwrap()
        .lines()
        .map(str::to_owned)
        .collect()
}

#[test]
fn minimal_package_objects_need_a_name_and_source() {
    let value: Package =
        serde_json::from_value(serde_json::json!({ "name": "git", "source": "pacman" })).unwrap();
    assert_eq!(value.name, "git");
    assert_eq!(value.version, None);
    assert_eq!(value.url, None);
    assert!(value.command.is_empty());
}

#[test]
fn pacman_dispatches_package_names_and_removes_duplicates() {
    scenario("pacman");
}

#[test]
fn aur_dispatches_package_names_and_removes_duplicates() {
    scenario("aur");
}

#[test]
fn mise_dispatches_package_versions_and_removes_duplicates() {
    scenario("mise");
}

#[test]
fn pacman_and_aur_require_packages_without_running_commands() {
    scenario("empty_packages");
}

#[test]
fn mise_without_packages_runs_its_native_install() {
    scenario("empty_mise");
}

#[test]
fn pacman_and_aur_reject_versions_without_running_commands() {
    scenario("unsupported_versions");
}

#[test]
fn install_scenario() {
    let Ok(scenario) = std::env::var("LUNA_INSTALL_TEST_SCENARIO") else {
        return;
    };
    match scenario.as_str() {
        "pacman" => {
            let packages = [
                package("git", None),
                package("base-devel", None),
                package("git", None),
            ];
            let report = install(Source::Pacman, &packages).unwrap();
            assert_eq!(report.installed, ["git", "base-devel"]);
            assert!(report.skipped.is_empty());
            assert_eq!(
                recorded_arguments(),
                [
                    "sudo",
                    "pacman",
                    "-S",
                    "--needed",
                    "--noconfirm",
                    "--",
                    "git",
                    "base-devel"
                ]
            );
        }
        "aur" => {
            let packages = [
                package("mpvpaper", None),
                package("fzf-tab", None),
                package("mpvpaper", None),
            ];
            let report = install(Source::Aur, &packages).unwrap();
            assert_eq!(report.installed, ["mpvpaper", "fzf-tab"]);
            assert_eq!(
                recorded_arguments(),
                [
                    "yay",
                    "-S",
                    "--aur",
                    "--needed",
                    "--noconfirm",
                    "--",
                    "mpvpaper",
                    "fzf-tab"
                ]
            );
        }
        "mise" => {
            let packages = [
                package("rust", Some("stable")),
                package("node", Some("lts")),
                package("bun", None),
                package("rust", Some("stable")),
            ];
            let report = install(Source::Mise, &packages).unwrap();
            assert_eq!(report.installed, ["rust@stable", "node@lts", "bun"]);
            assert_eq!(
                recorded_arguments(),
                [
                    "mise",
                    "install",
                    "--yes",
                    "--",
                    "rust@stable",
                    "node@lts",
                    "bun"
                ]
            );
        }
        "empty_packages" => {
            assert!(install(Source::Pacman, &[]).is_err());
            assert!(install(Source::Aur, &[]).is_err());
            assert!(!PathBuf::from(std::env::var_os("LUNA_INSTALL_TEST_LOG").unwrap()).exists());
        }
        "empty_mise" => {
            let report = install(Source::Mise, &[]).unwrap();
            assert!(report.installed.is_empty());
            assert_eq!(recorded_arguments(), ["mise", "install", "--yes", "--"]);
        }
        "unsupported_versions" => {
            for source in [Source::Pacman, Source::Aur] {
                let error = install(
                    source,
                    &[package("git", None), package("sample", Some("1.2"))],
                )
                .unwrap_err();
                assert!(
                    error.to_string().to_lowercase().contains("version"),
                    "{error}"
                );
            }
            assert!(!PathBuf::from(std::env::var_os("LUNA_INSTALL_TEST_LOG").unwrap()).exists());
        }
        _ => panic!("unknown install scenario: {scenario}"),
    }
}
