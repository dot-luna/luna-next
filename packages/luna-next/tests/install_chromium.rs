use std::{fs, os::unix::fs::PermissionsExt, path::PathBuf, process::Command};

use luna_next::install::{Package, Source, install, install_packages};

const BROWSER: &str = "ungoogled-chromium-bin";

fn package(name: &str) -> Package {
    Package {
        name: name.into(),
        source: Source::Aur,
        ..Package::default()
    }
}

fn scenario(name: &str, installed: &str, failing: &str) {
    let temporary = tempfile::tempdir().unwrap();
    let home = temporary.path().join("home");
    let bin = temporary.path().join("bin");
    let data = home.join(".config/chromium");
    fs::create_dir_all(data.join("Default")).unwrap();
    fs::create_dir(&bin).unwrap();
    let preferences = data.join("Default/Preferences");
    let state = data.join("Local State");
    fs::write(&preferences, "default profile bytes\n").unwrap();
    fs::write(&state, "browser local state bytes\n").unwrap();
    let package_state = temporary.path().join("packages");
    fs::write(&package_state, format!("{installed}\n")).unwrap();
    for program in ["yay", "sudo", "pacman", "mise"] {
        let path = bin.join(program);
        fs::write(
            &path,
            r#"#!/bin/sh
printf '%s\n' "${0##*/}" "$@" >> "$LUNA_CHROMIUM_INSTALL_LOG"
browser=false
for argument do
    if [ -n "$LUNA_CHROMIUM_INSTALL_FAIL" ] && [ "$argument" = "$LUNA_CHROMIUM_INSTALL_FAIL" ]; then
        exit 17
    fi
    if [ "$argument" = ungoogled-chromium-bin ]; then browser=true; fi
done
if [ "$browser" = true ]; then
    IFS= read -r installed < "$LUNA_CHROMIUM_INSTALL_PACKAGES"
    if [ "$installed" = chromium ]; then
        case "$*" in
            *'--ask 4 -- ungoogled-chromium-bin') ;;
            *) exit 23 ;;
        esac
    fi
    if [ "$installed" != ungoogled-chromium-bin ]; then
        printf '%s\n' ungoogled-chromium-bin > "$LUNA_CHROMIUM_INSTALL_PACKAGES"
    fi
fi
"#,
        )
        .unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    }
    let output = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "chromium_install_scenario", "--nocapture"])
        .env("HOME", home)
        .env("PATH", bin)
        .env("LUNA_CHROMIUM_INSTALL_SCENARIO", name)
        .env(
            "LUNA_CHROMIUM_INSTALL_LOG",
            temporary.path().join("commands"),
        )
        .env("LUNA_CHROMIUM_INSTALL_PACKAGES", &package_state)
        .env("LUNA_CHROMIUM_INSTALL_FAIL", failing)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{name}:\n{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        fs::read_to_string(preferences).unwrap(),
        "default profile bytes\n"
    );
    assert_eq!(
        fs::read_to_string(state).unwrap(),
        "browser local state bytes\n"
    );
    let expected = if name == "success" || name == "mixed" {
        BROWSER
    } else {
        installed
    };
    assert_eq!(fs::read_to_string(package_state).unwrap().trim(), expected);
}

fn commands() -> Vec<String> {
    fs::read_to_string(std::env::var_os("LUNA_CHROMIUM_INSTALL_LOG").unwrap())
        .unwrap()
        .lines()
        .map(str::to_owned)
        .collect()
}

fn aur_arguments(targets: &[&str], conflicts: bool) -> Vec<String> {
    let mut arguments = vec!["yay", "-S", "--aur", "--needed", "--noconfirm"];
    if conflicts {
        arguments.extend(["--ask", "4"]);
    }
    arguments.push("--");
    arguments.extend_from_slice(targets);
    arguments.into_iter().map(str::to_owned).collect()
}

#[test]
fn installs_ungoogled_chromium_on_a_clean_system_without_touching_profiles() {
    scenario("success", "none", "");
}

#[test]
fn replaces_stock_chromium_in_the_install_transaction_without_touching_profiles() {
    scenario("success", "chromium", "");
}

#[test]
fn already_installed_ungoogled_chromium_uses_needed_without_touching_profiles() {
    scenario("success", BROWSER, "");
}

#[test]
fn replacement_answers_are_limited_to_the_browser_transaction_in_catalog_order() {
    scenario("mixed", "chromium", "");
}

#[test]
fn failed_browser_install_preserves_stock_and_stops_later_packages_and_sources() {
    scenario("browser_failure", "chromium", BROWSER);
}

#[test]
fn failed_earlier_aur_install_does_not_replace_the_browser() {
    scenario("earlier_failure", "chromium", "mpvpaper");
}

#[test]
fn invalid_later_package_prevents_browser_replacement() {
    scenario("invalid", "chromium", "");
}

#[test]
fn chromium_install_scenario() {
    let Ok(scenario) = std::env::var("LUNA_CHROMIUM_INSTALL_SCENARIO") else {
        return;
    };
    match scenario.as_str() {
        "success" => {
            let report = install(Source::Aur, &[package(BROWSER)]).unwrap();
            assert_eq!(report.installed, [BROWSER]);
            assert!(report.skipped.is_empty());
            assert_eq!(commands(), aur_arguments(&[BROWSER], true));
        }
        "mixed" => {
            let report = install(
                Source::Aur,
                &[
                    package("mpvpaper"),
                    package(BROWSER),
                    package("fzf-tab"),
                    package(BROWSER),
                ],
            )
            .unwrap();
            assert_eq!(report.installed, ["mpvpaper", BROWSER, "fzf-tab"]);
            let expected = [
                aur_arguments(&["mpvpaper"], false),
                aur_arguments(&[BROWSER], true),
                aur_arguments(&["fzf-tab"], false),
            ]
            .concat();
            assert_eq!(commands(), expected);
        }
        "browser_failure" => {
            let error = install_packages(&[
                package(BROWSER),
                package("fzf-tab"),
                Package {
                    name: "rust".into(),
                    source: Source::Mise,
                    ..Package::default()
                },
            ])
            .unwrap_err();
            assert!(error.to_string().contains("17"), "{error}");
            assert_eq!(commands(), aur_arguments(&[BROWSER], true));
        }
        "earlier_failure" => {
            assert!(install(Source::Aur, &[package("mpvpaper"), package(BROWSER)]).is_err());
            assert_eq!(commands(), aur_arguments(&["mpvpaper"], false));
        }
        "invalid" => {
            let mut versioned = package("fzf-tab");
            versioned.version = Some("1.0".into());
            assert!(install(Source::Aur, &[package(BROWSER), versioned]).is_err());
            assert!(
                !PathBuf::from(std::env::var_os("LUNA_CHROMIUM_INSTALL_LOG").unwrap()).exists()
            );
        }
        _ => panic!("unknown scenario: {scenario}"),
    }
}
