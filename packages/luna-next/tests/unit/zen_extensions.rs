use std::{io::Write, os::unix::fs::PermissionsExt};

use serde_json::{Value, json};

use super::*;

const ID: &str = "uBlock0@raymondhill.net";

fn extension(id: &str, url: &str) -> Extension {
    Extension {
        id: id.into(),
        url: url.into(),
    }
}

fn xpi(manifest: &[u8], signed: bool) -> Vec<u8> {
    let mut archive = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default();
    archive.start_file("manifest.json", options).unwrap();
    archive.write_all(manifest).unwrap();
    if signed {
        // These markers test package screening only; Zen must verify real signatures.
        for name in [
            "META-INF/manifest.mf",
            "META-INF/mozilla.sf",
            "META-INF/mozilla.rsa",
        ] {
            archive.start_file(name, options).unwrap();
            archive.write_all(b"fixture-signature-marker").unwrap();
        }
    }
    archive.finish().unwrap().into_inner()
}

fn manifest() -> Vec<u8> {
    serde_json::to_vec(&json!({
        "manifest_version":2,"version":"1.0",
        "browser_specific_settings":{"gecko":{"id":ID}},
    }))
    .unwrap()
}

#[test]
fn accepts_current_and_legacy_declared_ids() {
    for key in ["browser_specific_settings", "applications"] {
        let manifest = json!({"manifest_version":2,"version":"1.0",key:{"gecko":{"id":ID}}});
        validate_archive(&xpi(&serde_json::to_vec(&manifest).unwrap(), true), ID).unwrap();
    }
}

#[test]
fn rejects_missing_mismatched_and_conflicting_extension_ids() {
    for manifest in [
        json!({"version":"1.0"}),
        json!({"browser_specific_settings":{"gecko":{"id":"other@example.com"}}}),
        json!({"browser_specific_settings":{"gecko":{"id":ID}}, "applications":{"gecko":{"id":"other@example.com"}}}),
    ] {
        let error =
            validate_archive(&xpi(&serde_json::to_vec(&manifest).unwrap(), true), ID).unwrap_err();
        assert!(error.to_string().contains("expected ID"), "{error}");
    }
}

#[test]
fn rejects_unsigned_invalid_and_oversized_archives() {
    assert!(validate_archive(b"not a ZIP archive", ID).is_err());
    assert!(validate_archive(&xpi(&manifest(), false), ID).is_err());
    assert!(validate_archive(&xpi(b"not JSON", true), ID).is_err());
    assert!(validate_archive(&xpi(&vec![b' '; MAX_MANIFEST as usize + 1], true), ID).is_err());
    let temporary = tempfile::tempdir().unwrap();
    let path = temporary.path().join("oversized.xpi");
    File::create(&path)
        .unwrap()
        .set_len(MAX_DOWNLOAD + 1)
        .unwrap();
    assert!(
        validate_package(&path, ID)
            .unwrap_err()
            .to_string()
            .contains("64 MiB")
    );
}

#[test]
fn validates_every_destination_id_and_url_before_downloads() {
    let stage = tempfile::tempdir().unwrap();
    for id in [
        "",
        ".",
        "..",
        "../escape",
        "slash/name",
        "back\\name",
        "line\nname",
        "quote'name",
        &"a".repeat(201),
    ] {
        assert!(
            prepare(
                &[extension(id, "https://example.com/extension.xpi")],
                stage.path()
            )
            .is_err(),
            "{id}"
        );
    }
    for url in [
        "http://example.com/a.xpi",
        "file:///tmp/a.xpi",
        "https://user@example.com/a.xpi",
        "https://example.com/a.xpi#fragment",
        "https://example.com/a\nxpi",
    ] {
        assert!(
            prepare(&[extension(ID, url)], stage.path()).is_err(),
            "{url}"
        );
    }
    assert!(
        prepare(
            &[
                extension(ID, "https://example.com/a.xpi"),
                extension(ID, "https://example.com/b.xpi")
            ],
            stage.path()
        )
        .is_err()
    );
    assert_eq!(fs::read_dir(stage.path()).unwrap().count(), 0);
}

struct Fixture {
    directory: tempfile::TempDir,
}

impl Fixture {
    fn new(package: &[u8], expected_error: Option<&str>, exit: i32) -> Self {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir(directory.path().join("bin")).unwrap();
        fs::create_dir(directory.path().join("stage")).unwrap();
        fs::write(directory.path().join("source.xpi"), package).unwrap();
        fs::write(
            directory.path().join("config.json"),
            serde_json::to_vec(&json!({"error":expected_error,"exit":exit})).unwrap(),
        )
        .unwrap();
        let executable = directory.path().join("bin/curl");
        fs::write(
            &executable,
            r#"#!/usr/bin/python3
import json, os, pathlib, shutil, sys
root=pathlib.Path(os.environ['LUNA_ZEN_EXTENSION_TEST_FIXTURE'])
args=sys.argv[1:]
(root/'arguments.json').write_text(json.dumps(args))
config=json.loads((root/'config.json').read_text())
if config['exit']:
    print('fixture download failure',file=sys.stderr)
    sys.exit(config['exit'])
shutil.copyfile(root/'source.xpi', args[args.index('--output')+1])
"#,
        )
        .unwrap();
        fs::set_permissions(executable, fs::Permissions::from_mode(0o755)).unwrap();
        Self { directory }
    }

    fn run(&self) -> Vec<String> {
        let path = std::env::join_paths(
            [self.directory.path().join("bin")]
                .into_iter()
                .chain(std::env::split_paths(&std::env::var_os("PATH").unwrap())),
        )
        .unwrap();
        let output = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "zen::extensions::tests::prepare_in_child",
                "--nocapture",
            ])
            .env("LUNA_ZEN_EXTENSION_TEST_FIXTURE", self.directory.path())
            .env("PATH", path)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        serde_json::from_slice(&fs::read(self.directory.path().join("arguments.json")).unwrap())
            .unwrap()
    }
}

#[test]
fn prepare_in_child() {
    let Some(root) = std::env::var_os("LUNA_ZEN_EXTENSION_TEST_FIXTURE") else {
        return;
    };
    let root = PathBuf::from(root);
    let config: Value =
        serde_json::from_slice(&fs::read(root.join("config.json")).unwrap()).unwrap();
    let result = prepare(
        &[extension(
            ID,
            "https://addons.mozilla.org/firefox/downloads/latest/ublock-origin/latest.xpi",
        )],
        &root.join("stage"),
    );
    if let Some(expected) = config["error"].as_str() {
        let error = result.err().expect("expected failure").to_string();
        assert!(error.contains(expected), "{error}");
    } else {
        let prepared = result.unwrap();
        assert_eq!(prepared.len(), 1);
        assert_eq!(prepared[0].id, ID);
        assert_eq!(prepared[0].path, root.join(format!("stage/{ID}.xpi")));
        assert_eq!(
            fs::read(&prepared[0].path).unwrap(),
            fs::read(root.join("source.xpi")).unwrap()
        );
    }
}

#[test]
fn stages_signed_packages_with_bounded_https_curl_settings() {
    let fixture = Fixture::new(&xpi(&manifest(), true), None, 0);
    let arguments = fixture.run();
    assert_eq!(arguments[0], "--disable");
    for pair in [
        ["--proto", "=https"],
        ["--proto-redir", "=https"],
        ["--max-time", "120"],
        ["--max-filesize", "67108864"],
        ["--max-redirs", "5"],
    ] {
        assert!(
            arguments.windows(2).any(|window| window == pair),
            "{pair:?}"
        );
    }
    assert_eq!(
        fs::read_dir(fixture.directory.path().join("stage"))
            .unwrap()
            .count(),
        1
    );
}

#[test]
fn reports_http_failures_and_rejects_downloaded_unsigned_packages() {
    Fixture::new(
        &xpi(&manifest(), true),
        Some("fixture download failure"),
        22,
    )
    .run();
    Fixture::new(&xpi(&manifest(), false), Some("META-INF/manifest.mf"), 0).run();
}

#[test]
fn refuses_existing_staging_entries_and_symlink_packages() {
    let temporary = tempfile::tempdir().unwrap();
    let target = temporary.path().join("outside");
    fs::write(&target, "untouched").unwrap();
    let destination = temporary.path().join(format!("{ID}.xpi"));
    std::os::unix::fs::symlink(&target, &destination).unwrap();
    let error = prepare(
        &[extension(ID, "https://example.com/a.xpi")],
        temporary.path(),
    )
    .err()
    .unwrap()
    .to_string();
    assert!(error.contains("already exists"), "{error}");
    assert!(validate_package(&destination, ID).is_err());
    assert_eq!(fs::read_to_string(target).unwrap(), "untouched");
}
