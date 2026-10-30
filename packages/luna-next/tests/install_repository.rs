use luna_next::install::find_repository;
use std::{fs, path::Path, process::Command};

fn scenario(name: &str) {
    let root = tempfile::tempdir().unwrap();
    let output = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "repository_scenario", "--nocapture"])
        .env_clear()
        .env("HOME", root.path().join("home"))
        .env("LUNA_REPOSITORY_TEST_ROOT", root.path())
        .env("LUNA_REPOSITORY_TEST_SCENARIO", name)
        .current_dir(root.path())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{name}:\n{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn checkout(path: &Path) {
    fs::create_dir_all(path.join("installs")).unwrap();
    fs::write(
        path.join("installs/packages.conf"),
        "core = []\nmain = []\n",
    )
    .unwrap();
}

#[test]
fn explicit_and_environment_roots_take_precedence_over_managed_and_cwd_checkouts() {
    scenario("precedence");
}

#[test]
fn managed_checkout_takes_precedence_over_a_competing_development_checkout() {
    scenario("managed");
}

#[test]
fn invalid_selected_roots_do_not_fall_through_to_a_valid_checkout() {
    scenario("invalid");
}

#[test]
fn empty_environment_root_allows_development_ancestor_discovery() {
    scenario("development");
}

#[test]
fn unrelated_directory_without_a_checkout_does_not_use_the_build_directory() {
    scenario("missing");
}

#[test]
fn repository_scenario() {
    let Ok(name) = std::env::var("LUNA_REPOSITORY_TEST_SCENARIO") else {
        return;
    };
    let root = std::path::PathBuf::from(std::env::var_os("LUNA_REPOSITORY_TEST_ROOT").unwrap());
    let managed = root.join("home/.local/src/luna-next");
    let development = root.join("development");
    let selected = root.join("selected");
    let explicit = root.join("explicit");
    match name.as_str() {
        "precedence" => {
            for path in [&managed, &development, &selected, &explicit] {
                checkout(path);
            }
            std::env::set_current_dir(&development).unwrap();
            // Each scenario runs alone in a subprocess, so environment changes
            // cannot affect another test or the user's session.
            unsafe { std::env::set_var("LUNA_NEXT_ROOT", &selected) };
            assert_eq!(find_repository(None).unwrap(), selected);
            assert_eq!(find_repository(Some(&explicit)).unwrap(), explicit);
            unsafe { std::env::set_var("LUNA_NEXT_ROOT", root.join("missing")) };
            assert_eq!(find_repository(Some(&explicit)).unwrap(), explicit);
        }
        "managed" => {
            checkout(&managed);
            checkout(&development);
            let nested = development.join("src/nested");
            fs::create_dir_all(&nested).unwrap();
            std::env::set_current_dir(&nested).unwrap();
            assert_eq!(find_repository(None).unwrap(), managed);
        }
        "invalid" => {
            checkout(&development);
            std::env::set_current_dir(&development).unwrap();
            fs::create_dir_all(&managed).unwrap();
            assert!(find_repository(None).is_err());
            fs::remove_dir_all(&managed).unwrap();
            checkout(&managed);
            let missing = root.join("missing");
            unsafe { std::env::set_var("LUNA_NEXT_ROOT", &missing) };
            assert!(find_repository(None).is_err());
            assert!(find_repository(Some(&missing)).is_err());
            fs::create_dir(&selected).unwrap();
            unsafe { std::env::set_var("LUNA_NEXT_ROOT", &selected) };
            assert!(find_repository(None).is_err());
            assert!(!missing.exists());
        }
        "development" => {
            checkout(&development);
            let nested = development.join("src/nested");
            fs::create_dir_all(&nested).unwrap();
            std::env::set_current_dir(&nested).unwrap();
            unsafe { std::env::set_var("LUNA_NEXT_ROOT", "") };
            assert_eq!(find_repository(None).unwrap(), development);
        }
        "missing" => {
            let error = find_repository(None).unwrap_err().to_string();
            assert!(
                error.contains("Cannot find the Luna Next checkout"),
                "{error}"
            );
            assert!(!managed.exists());
        }
        _ => panic!("unknown scenario {name}"),
    }
}
