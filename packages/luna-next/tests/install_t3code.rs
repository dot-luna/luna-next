use std::{fs, os::unix::fs::PermissionsExt, path::Path, process::Command};

use luna_next::install::{Source, get_packages};

#[test]
fn t3code_recipe_runs_the_project_builder_in_the_selected_checkout() {
    let repository = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    let package = get_packages(&repository, &[], Some(Source::Git), &["t3code".into()])
        .unwrap()
        .remove(0);
    let temporary = tempfile::tempdir().unwrap();
    let bin = temporary.path().join("bin");
    let checkout = temporary.path().join("checkout");
    fs::create_dir(&bin).unwrap();
    fs::create_dir(&checkout).unwrap();
    // Replace tool execution only; run the catalog's actual shell command from a different directory.
    let mise = bin.join("mise");
    fs::write(
        &mise,
        r#"#!/bin/sh
for argument do printf '%s\n' "$argument" >> "$T3_RECIPE_LOG"; done
printf '%s\n' "$LUNA_PACKAGE_VERSION" "$LUNA_NEXT_ROOT" "$PWD" >> "$T3_RECIPE_LOG"
"#,
    )
    .unwrap();
    fs::set_permissions(&mise, fs::Permissions::from_mode(0o755)).unwrap();
    let selected = "v0.1.6-nightly.20261029.3892";
    let log = temporary.path().join("recipe-log");
    for arguments in &package.command {
        let output = Command::new(&arguments[0])
            .args(&arguments[1..])
            .env_clear()
            .env("PATH", format!("{}:/usr/bin:/bin", bin.display()))
            .env("LUNA_PACKAGE_VERSION", selected)
            .env("LUNA_NEXT_ROOT", package.repository.as_ref().unwrap())
            .env("T3_RECIPE_LOG", &log)
            .current_dir(&checkout)
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
    }
    let calls = fs::read_to_string(log).unwrap();
    let arguments: Vec<_> = calls.lines().collect();
    assert_eq!(
        &arguments[..7],
        &[
            "exec",
            "--yes",
            "node@lts",
            "pnpm@latest",
            "--",
            "node",
            repository
                .join("apps/t3code/src/build.cjs")
                .to_str()
                .unwrap()
        ]
    );
    assert_eq!(
        &arguments[7..],
        &[
            selected,
            repository.to_str().unwrap(),
            checkout.to_str().unwrap()
        ]
    );
    assert!(repository.join("apps/t3code/src/build.cjs").is_file());
}
