use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    io::Cursor,
    os::unix::fs::symlink,
};

use super::*;

struct Fixture {
    temporary: tempfile::TempDir,
    profile: PathBuf,
    packages: PathBuf,
    appearance: PathBuf,
    binary: PathBuf,
    prepared: Vec<extensions::PreparedExtension>,
}

impl Fixture {
    fn new() -> Self {
        let temporary = tempfile::tempdir().unwrap();
        let profile = temporary.path().join("Profile <&\" name");
        let packages = temporary.path().join("packages");
        let appearance = temporary.path().join("appearance");
        for directory in [&profile, &packages, &appearance] {
            fs::create_dir(directory).unwrap();
        }
        fs::write(
            profile.join("Preferences"),
            br#"{"profile":{"name":"Name <&\"' test"}}"#,
        )
        .unwrap();
        let prepared = [
            "epcnnfbjfcgphgdmggkamkmgojdagdnn",
            "mnjggcdmjocbbbhaepdhchncahnbgone",
            "kmfcinojnfabkpndlgomnfjllgeppegb",
            "cmedhionkhpnakcndndgjdbohmhepckk",
            "nngceckbapebfimnlniiiahkandclblb",
        ]
        .into_iter()
        .map(|id| {
            let filename = format!("{id}.crx");
            fs::write(
                packages.join(&filename),
                crx(br#"{"version":"1.2.3"}"#, b"store-fixture-key"),
            )
            .unwrap();
            extensions::PreparedExtension {
                id: id.into(),
                version: "1.2.3".into(),
                filename,
            }
        })
        .collect();
        for name in APPEARANCE {
            let directory = appearance.join(name);
            fs::create_dir(&directory).unwrap();
            fs::write(
                directory.join("manifest.json"),
                br#"{"name":"Fixture","manifest_version":3,"version":"2.3.4"}"#,
            )
            .unwrap();
        }
        fs::write(
            appearance.join("websites/style.css"),
            "* { border-radius: 0; }",
        )
        .unwrap();
        let binary = temporary.path().join("fake-chromium");
        let fixture = Self {
            temporary,
            profile,
            packages,
            appearance,
            binary,
            prepared,
        };
        fixture.packer("success");
        fixture
    }

    fn packer(&self, mode: &str) {
        let quote = |path: &Path| format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"));
        let args = self.temporary.path().join("pack-arguments");
        let log = self.temporary.path().join("pack-log");
        fs::write(&self.binary, format!(
            "#!/bin/sh\nprintf '%s\\n' \"$@\" > {}\nprintf 'CALL\\n' >> {}\nprintf '%s\\n' \"$@\" >> {}\nexport LUNA_CHROMIUM_PACK_TEST_ARGS={}\nexport LUNA_CHROMIUM_PACK_TEST_MODE='{mode}'\nexport LUNA_CHROMIUM_PACK_TEST_ORIGINAL_KEY={}\nexec {} --exact chromium::installation::tests::pack_in_child --nocapture\n",
            quote(&args),quote(&log),quote(&log),quote(&args),quote(&self.profile.join("Luna Next/keys/theme.pem")),quote(&std::env::current_exe().unwrap())
        )).unwrap();
        fs::set_permissions(&self.binary, fs::Permissions::from_mode(0o755)).unwrap();
    }

    fn prepare(&self, name: &str) -> Result<PathBuf> {
        let stage = self.temporary.path().join(name);
        fs::create_dir(&stage).unwrap();
        prepare(
            &self.binary,
            &self.profile,
            &self.packages,
            &self.prepared,
            &self.appearance,
            &stage,
        )
    }

    fn publish_fixture(&self, bundle: &Path) {
        let previous = self.profile.join("Luna Next");
        fs::create_dir(&previous).unwrap();
        copy_tree(bundle, &previous, bundle).unwrap();
    }

    fn log(&self) -> String {
        fs::read_to_string(self.temporary.path().join("pack-log")).unwrap_or_default()
    }
}

fn encode_varint(mut value: u64) -> Vec<u8> {
    let mut bytes = Vec::new();
    while value >= 128 {
        bytes.push((value as u8 & 127) | 128);
        value >>= 7;
    }
    bytes.push(value as u8);
    bytes
}

fn crx(manifest: &[u8], key: &[u8]) -> Vec<u8> {
    let mut hash = DefaultHasher::new();
    key.hash(&mut hash);
    let mut signed = vec![0x0a, 0x10];
    signed.extend(hash.finish().to_le_bytes().repeat(2));
    let mut header = encode_varint(10000 << 3 | 2);
    header.extend(encode_varint(signed.len() as u64));
    header.extend(signed);
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    zip.start_file("manifest.json", zip::write::SimpleFileOptions::default())
        .unwrap();
    zip.write_all(manifest).unwrap();
    let mut bytes = b"Cr24".to_vec();
    bytes.extend(3u32.to_le_bytes());
    bytes.extend((header.len() as u32).to_le_bytes());
    bytes.extend(header);
    bytes.extend(zip.finish().unwrap().into_inner());
    bytes
}

#[test]
fn pack_in_child() {
    let Some(args) = std::env::var_os("LUNA_CHROMIUM_PACK_TEST_ARGS") else {
        return;
    };
    let arguments = fs::read_to_string(args).unwrap();
    let argument = |name: &str| {
        arguments
            .lines()
            .find_map(|line| line.strip_prefix(name))
            .map(PathBuf::from)
    };
    let source = argument("--pack-extension=").unwrap();
    if std::env::var("LUNA_CHROMIUM_PACK_TEST_MODE").unwrap() == "fail-websites"
        && source.file_name().unwrap() == "websites"
    {
        std::process::exit(21);
    }
    let key = match argument("--pack-extension-key=") {
        Some(path) => fs::read(path).unwrap(),
        None => {
            let key =
                format!("fake-key-{}", source.file_name().unwrap().to_string_lossy()).into_bytes();
            fs::write(source.with_extension("pem"), &key).unwrap();
            key
        }
    };
    let manifest = fs::read(source.join("manifest.json")).unwrap();
    fs::write(source.with_extension("crx"), crx(&manifest, &key)).unwrap();
    if std::env::var("LUNA_CHROMIUM_PACK_TEST_MODE").unwrap() == "edit-key"
        && source.file_name().unwrap() == "websites"
    {
        fs::write(
            std::env::var_os("LUNA_CHROMIUM_PACK_TEST_ORIGINAL_KEY").unwrap(),
            b"external key edit",
        )
        .unwrap();
    }
}

#[test]
fn stages_seven_signed_packages_without_publishing_or_opening_the_profile() {
    let fixture = Fixture::new();
    let before = fs::read(fixture.profile.join("Preferences")).unwrap();
    let source_manifest = fs::read(fixture.appearance.join("theme/manifest.json")).unwrap();
    let bundle = fixture.prepare("first").unwrap();
    assert!(!fixture.profile.join("Luna Next").exists());
    assert_eq!(
        fs::read(fixture.profile.join("Preferences")).unwrap(),
        before
    );
    assert_eq!(
        fs::read(fixture.appearance.join("theme/manifest.json")).unwrap(),
        source_manifest
    );
    for extension in &fixture.prepared {
        assert_eq!(
            fs::read(bundle.join("extensions").join(&extension.filename)).unwrap(),
            fs::read(fixture.packages.join(&extension.filename)).unwrap()
        );
    }
    for name in APPEARANCE {
        assert!(bundle.join(format!("{name}.crx")).is_file());
        assert_eq!(
            fs::metadata(bundle.join(format!("keys/{name}.pem")))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        assert_eq!(
            fs::metadata(
                fixture
                    .temporary
                    .path()
                    .join(format!("first/packing/{name}.pem"))
            )
            .unwrap()
            .permissions()
            .mode()
                & 0o777,
            0o600
        );
    }
    for directory in [&bundle, &bundle.join("keys"), &bundle.join("extensions")] {
        assert_eq!(
            fs::metadata(directory).unwrap().permissions().mode() & 0o777,
            0o700
        );
    }
    let log = fixture.log();
    assert_eq!(log.lines().filter(|line| *line == "CALL").count(), 2);
    assert!(log.contains("--headless\n"));
    assert!(log.contains("--user-data-dir="));
    assert!(!log.contains(&format!("--user-data-dir={}", fixture.profile.display())));
    assert!(!log.contains("--pack-extension-key="));
}

#[test]
fn installation_page_escapes_profile_text_and_links_exact_packages() {
    let fixture = Fixture::new();
    let bundle = fixture.prepare("page").unwrap();
    let page = fs::read_to_string(bundle.join("install.html")).unwrap();
    assert!(page.contains("Name &lt;&amp;&quot;&#39; test"));
    assert!(page.contains("Profile &lt;&amp;&quot; name"));
    assert!(!page.contains("<script"));
    assert_eq!(page.matches(".crx\"").count(), 7);
    assert!(page.contains("href=\"chrome://extensions/\""));
    assert!(page.contains(">uBlock</a>"));
    assert!(!page.contains("uBlock Origin"));
    assert!(page.contains(">Bitwarden</a>"));
    for extension in &fixture.prepared {
        assert_eq!(
            page.matches(&format!("href=\"extensions/{}.crx\"", extension.id))
                .count(),
            1
        );
    }
}

#[test]
fn reuses_private_signers_and_increases_versions_even_ahead_of_the_clock() {
    let fixture = Fixture::new();
    let first = fixture.prepare("first").unwrap();
    fixture.publish_fixture(&first);
    let previous = fixture.profile.join("Luna Next");
    let key = fs::read(previous.join("keys/theme.pem")).unwrap();
    fs::write(
        previous.join("theme.crx"),
        crx(br#"{"version":"65000.0.0.0"}"#, &key),
    )
    .unwrap();
    let theme_id = package_identity(&previous.join("theme.crx")).unwrap();
    let website_id = package_identity(&previous.join("websites.crx")).unwrap();
    let second = fixture.prepare("second").unwrap();
    assert_eq!(
        extensions::package_version(&second.join("theme.crx")).unwrap(),
        "65000.0.0.1"
    );
    assert_eq!(
        package_identity(&second.join("theme.crx")).unwrap(),
        theme_id
    );
    assert_eq!(
        package_identity(&second.join("websites.crx")).unwrap(),
        website_id
    );
    for name in APPEARANCE {
        assert_eq!(
            fs::read(second.join(format!("keys/{name}.pem"))).unwrap(),
            fs::read(previous.join(format!("keys/{name}.pem"))).unwrap()
        );
    }
    let log = fixture.log();
    assert_eq!(log.matches("--pack-extension-key=").count(), 2);
    assert!(log.contains("second/bundle/keys/theme.pem"));
    assert!(!log.contains(&format!("--pack-extension-key={}", previous.display())));
    assert_eq!(
        extensions::package_version(&previous.join("theme.crx")).unwrap(),
        "65000.0.0.0"
    );
}

#[test]
fn packing_failure_leaves_existing_packages_and_signers_unchanged() {
    let fixture = Fixture::new();
    let first = fixture.prepare("first").unwrap();
    fixture.publish_fixture(&first);
    let previous = fixture.profile.join("Luna Next");
    let package = fs::read(previous.join("theme.crx")).unwrap();
    let key = fs::read(previous.join("keys/theme.pem")).unwrap();
    fixture.packer("fail-websites");
    assert!(
        fixture
            .prepare("failure")
            .unwrap_err()
            .to_string()
            .contains("pack Chromium websites")
    );
    assert_eq!(fs::read(previous.join("theme.crx")).unwrap(), package);
    assert_eq!(fs::read(previous.join("keys/theme.pem")).unwrap(), key);
}

#[test]
fn detects_signer_edits_during_packing_and_preserves_the_external_edit() {
    let fixture = Fixture::new();
    let first = fixture.prepare("first").unwrap();
    fixture.publish_fixture(&first);
    let previous = fixture.profile.join("Luna Next");
    let package = fs::read(previous.join("theme.crx")).unwrap();
    fixture.packer("edit-key");
    assert!(
        fixture
            .prepare("edited")
            .unwrap_err()
            .to_string()
            .contains("changed externally")
    );
    assert_eq!(
        fs::read(previous.join("keys/theme.pem")).unwrap(),
        b"external key edit"
    );
    assert_eq!(fs::read(previous.join("theme.crx")).unwrap(), package);
}

#[test]
fn refuses_lost_mismatched_and_unrecognized_signers() {
    for failure in ["missing", "mismatch", "unknown", "symlink"] {
        let fixture = Fixture::new();
        let first = fixture.prepare("first").unwrap();
        fixture.publish_fixture(&first);
        let previous = fixture.profile.join("Luna Next");
        let key_path = previous.join("keys/theme.pem");
        match failure {
            "missing" => fs::remove_file(&key_path).unwrap(),
            "mismatch" => fs::write(&key_path, b"different-key").unwrap(),
            "unknown" => fs::write(previous.join("keys/unknown.pem"), b"unknown-key").unwrap(),
            "symlink" => {
                fs::remove_file(&key_path).unwrap();
                symlink(previous.join("keys/websites.pem"), &key_path).unwrap();
            }
            _ => unreachable!(),
        }
        let package = fs::read(previous.join("theme.crx")).unwrap();
        let error = fixture.prepare("invalid").unwrap_err().to_string();
        let expected = match failure {
            "missing" => "Missing signing key",
            "mismatch" => "does not match",
            "unknown" => "Unrecognized Chromium signing key",
            _ => "must not contain links",
        };
        assert!(error.contains(expected), "{failure}: {error}");
        assert_eq!(fs::read(previous.join("theme.crx")).unwrap(), package);
        if failure == "mismatch" {
            assert_eq!(fs::read(&key_path).unwrap(), b"different-key");
        }
        if failure == "unknown" {
            assert_eq!(
                fs::read(previous.join("keys/unknown.pem")).unwrap(),
                b"unknown-key"
            );
        }
        if failure == "symlink" {
            assert!(fs::symlink_metadata(&key_path).unwrap().is_symlink());
        }
    }
}

#[test]
fn rejects_version_overflow_and_malformed_signed_identity() {
    assert!(next_version(Some("65535.65535.65535.65535")).is_err());
    assert!(next_version(Some("not.a.version")).is_err());
    assert!(bytes_field(&[0x0a, 0x10, 1], 1).is_err());
    assert!(bytes_field(&[0x08, 1], 1).is_err());
    assert!(bytes_field(&[0x0a, 0, 0x0a, 0], 1).is_err());
    let mut malformed_varint = [0xff; 12].as_slice();
    assert!(varint(&mut malformed_varint).is_err());
    let fixture = Fixture::new();
    let path = fixture.temporary.path().join("bad.crx");
    let mut bad = crx(br#"{"version":"1"}"#, b"key");
    bad[12] = 0;
    fs::write(&path, bad).unwrap();
    assert!(package_identity(&path).is_err());
}
