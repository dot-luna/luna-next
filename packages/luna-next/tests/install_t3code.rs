use std::{fs, os::unix::fs::PermissionsExt, path::Path, process::Command};

use luna_next::install::{Source, get_packages};

#[test]
fn t3code_recipe_downloads_the_selected_release_and_installs_in_the_user_bin() {
    let repository = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let package = get_packages(&repository, &[], Some(Source::Git), &["t3code".into()])
        .unwrap()
        .remove(0);
    let temporary = tempfile::tempdir().unwrap();
    let home = temporary.path().join("home");
    let bin = temporary.path().join("bin");
    let checkout = temporary.path().join("checkout");
    fs::create_dir(&bin).unwrap();
    fs::create_dir(&checkout).unwrap();
    let curl = bin.join("curl");
    // Substitute only the network transfer; execute the catalog's real shell and install commands.
    fs::write(
        &curl,
        r#"#!/bin/sh
while [ "$#" -gt 0 ]; do
    case "$1" in
        --output) output=$2; shift 2 ;;
        https://*) printf '%s' "$1" > "$T3_RECIPE_URL"; shift ;;
        *) shift ;;
    esac
done
printf '%s' 'test AppImage payload' > "$output"
"#,
    )
    .unwrap();
    fs::set_permissions(&curl, fs::Permissions::from_mode(0o755)).unwrap();
    let selected = "v0.1.6-nightly.20261029.3892";
    let requested_url = temporary.path().join("requested-url");
    for arguments in &package.command {
        let output = Command::new(&arguments[0])
            .args(&arguments[1..])
            .env_clear()
            .env("HOME", &home)
            .env("PATH", format!("{}:/usr/bin:/bin", bin.display()))
            .env("LUNA_PACKAGE_VERSION", selected)
            .env("T3_RECIPE_URL", &requested_url)
            .current_dir(&checkout)
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
    }
    let installed = home.join(".local/bin/t3code");
    assert_eq!(
        fs::read_to_string(&installed).unwrap(),
        "test AppImage payload"
    );
    assert_eq!(
        fs::metadata(installed).unwrap().permissions().mode() & 0o777,
        0o755
    );
    assert_eq!(
        fs::read_to_string(requested_url).unwrap(),
        format!(
            "https://github.com/pingdotgg/t3code/releases/download/{selected}/T3-Code-{}-x86_64.AppImage",
            selected.trim_start_matches('v')
        )
    );
}
