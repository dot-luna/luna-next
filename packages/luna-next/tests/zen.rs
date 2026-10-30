use std::{
    collections::BTreeMap,
    fs,
    io::{Cursor, Write},
    os::{
        fd::AsRawFd,
        unix::fs::{PermissionsExt, symlink},
    },
    path::{Path, PathBuf},
    process::Command,
};

use luna_next::zen::{Paths, Zen};
use serde_json::{Value, json};

const IDS: [&str; 2] = [
    "uBlock0@raymondhill.net",
    "{446900e4-71c2-419f-a6a7-df9c091e268b}",
];

struct Fixture {
    temporary: tempfile::TempDir,
    profiles: PathBuf,
    settings: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path();
        let settings = root.join("settings");
        fs::create_dir(&settings).unwrap();
        fs::create_dir(root.join("bin")).unwrap();
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/zen/config");
        for entry in fs::read_dir(source).unwrap() {
            let entry = entry.unwrap();
            fs::copy(entry.path(), settings.join(entry.file_name())).unwrap();
        }
        for id in IDS {
            write(root.join(format!("fixtures/{id}.xpi")), &xpi(id));
        }
        for (name, script) in [
            (
                "pacman",
                "[ \"$*\" = '-Q zen-browser-bin' ] || exit 12\n[ ! -f \"$LUNA_ZEN_TEST_ROOT/no-provider\" ] || exit 13\nprintf '%s\\n' 'zen-browser-bin 1.24b-1'\n",
            ),
            (
                "zen-browser",
                "[ \"$*\" = --version ] || exit 14\nprintf '%s\\n' 'Zen Browser 1.24b'\n",
            ),
            (
                "curl",
                r#"exec /usr/bin/python3 -c '
import os, pathlib, shutil, sys
root = pathlib.Path(os.environ["LUNA_ZEN_TEST_ROOT"])
args = sys.argv[1:]
destination = pathlib.Path(args[args.index("--output") + 1])
with (root / "downloads").open("a") as log: log.write(destination.name + "\n")
edit = os.environ.get("LUNA_ZEN_TEST_EDIT")
if edit: pathlib.Path(edit).write_text("external editor bytes\n")
if (root / "download-fail").exists(): sys.exit(17)
shutil.copyfile(root / "fixtures" / destination.name, destination)
' "$@"
"#,
            ),
        ] {
            let path = root.join("bin").join(name);
            fs::write(&path, format!("#!/bin/sh\n{script}")).unwrap();
            fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
        }
        let profiles = root.join("profiles");
        Self {
            temporary,
            profiles,
            settings,
        }
    }

    fn root(&self) -> &Path {
        self.temporary.path()
    }
    fn profile(&self) -> PathBuf {
        self.profiles.join("main.default-release")
    }

    fn standard(&self) {
        self.registry("[InstallABC]\nDefault=main.default-release\nLocked=1\n\n[Profile0]\nName=default-release\nIsRelative=1\nPath=main.default-release\nDefault=1\n");
        write(
            self.profile().join("prefs.js"),
            b"// browser-owned prefs\nuser_pref(\"keep\",true);\n",
        );
        write(self.profile().join("places.sqlite"), b"personal bookmarks");
        write(
            self.profile().join("extensions.json"),
            b"browser-owned extension index",
        );
        write(
            self.profile().join("extensions/darkreader@existing.xpi"),
            b"personal existing extension",
        );
        write(self.profiles.join("other/prefs.js"), b"sibling preferences");
        write(self.profiles.join("other/user.js"), b"sibling appearance");
    }

    fn registry(&self, text: &str) {
        write(self.profiles.join("profiles.ini"), text.as_bytes());
    }

    fn invoke(&self, action: &str, profile: Option<&Path>, edit: Option<&Path>) -> String {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args(["--exact", "configure_in_child", "--nocapture"])
            .env_clear()
            .env("HOME", self.root().join("home"))
            .env("XDG_CONFIG_HOME", self.root().join("config"))
            .env("PATH", self.root().join("bin"))
            .env("LUNA_ZEN_TEST_ROOT", self.root())
            .env("LUNA_ZEN_TEST_PROFILES", &self.profiles)
            .env("LUNA_ZEN_TEST_SETTINGS", &self.settings)
            .env("LUNA_ZEN_TEST_ACTION", action);
        if let Some(profile) = profile {
            command.env("LUNA_ZEN_TEST_PROFILE", profile);
        }
        if let Some(edit) = edit {
            command.env("LUNA_ZEN_TEST_EDIT", edit);
        }
        let output = command.output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            output.stderr.is_empty(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap()
    }

    fn snapshot(&self) -> BTreeMap<PathBuf, Vec<u8>> {
        let mut files = BTreeMap::new();
        snapshot(&self.profiles, &mut files);
        files
    }

    fn downloads(&self) -> usize {
        fs::read_to_string(self.root().join("downloads"))
            .unwrap_or_default()
            .lines()
            .count()
    }
}

fn write(path: PathBuf, bytes: &[u8]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, bytes).unwrap();
}

fn xpi(id: &str) -> Vec<u8> {
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (name, bytes) in [
        ("manifest.json", serde_json::to_vec(&json!({"manifest_version":2,"name":"Fixture","version":"1.0","browser_specific_settings":{"gecko":{"id":id}}})).unwrap()),
        ("META-INF/manifest.mf", b"signature fixture".to_vec()),
        ("META-INF/mozilla.sf", b"signature fixture".to_vec()),
        ("META-INF/mozilla.rsa", b"signature fixture".to_vec()),
    ] {
        zip.start_file(name, zip::write::SimpleFileOptions::default()).unwrap();
        zip.write_all(&bytes).unwrap();
    }
    zip.finish().unwrap().into_inner()
}

fn snapshot(path: &Path, files: &mut BTreeMap<PathBuf, Vec<u8>>) {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return;
    };
    if metadata.is_symlink() {
        files.insert(
            path.into(),
            fs::read_link(path)
                .unwrap()
                .as_os_str()
                .as_encoded_bytes()
                .to_vec(),
        );
    } else if metadata.is_dir() {
        for entry in fs::read_dir(path).unwrap() {
            snapshot(&entry.unwrap().path(), files);
        }
    } else if !matches!(
        path.file_name().and_then(|name| name.to_str()),
        Some(".parentlock" | ".luna-config.lock")
    ) {
        files.insert(path.into(), fs::read(path).unwrap());
    }
}

fn success(output: &str) -> Value {
    let value = output
        .lines()
        .find_map(|line| line.strip_prefix("ZEN_OK: "))
        .unwrap_or_else(|| panic!("{output}"));
    serde_json::from_str(value).unwrap()
}

#[test]
fn configures_only_declared_exports_in_the_existing_native_default() {
    let fixture = Fixture::new();
    fixture.standard();
    write(
        fixture.profile().join("user.js"),
        b"old user.js is replaced",
    );
    write(
        fixture.profile().join("chrome/userChrome.css"),
        b"old UI is replaced",
    );
    write(
        fixture.profile().join("chrome/unrelated.css"),
        b"preserve outside exports",
    );
    write(
        fixture.profile().join(format!("extensions/{}.xpi", IDS[0])),
        b"old declared extension",
    );
    fs::set_permissions(
        fixture.profile().join("user.js"),
        fs::Permissions::from_mode(0o640),
    )
    .unwrap();
    let before = fixture.snapshot();
    let configured = success(&fixture.invoke("configure", None, None));
    assert_eq!(configured["profile"], json!(fixture.profile()));
    assert_eq!(configured["extensions"], json!(IDS));
    for (path, bytes) in before {
        if path == fixture.profile().join("user.js")
            || path == fixture.profile().join("chrome/userChrome.css")
            || path == fixture.profile().join(format!("extensions/{}.xpi", IDS[0]))
        {
            continue;
        }
        assert_eq!(fs::read(path).unwrap(), bytes);
    }
    assert!(
        fs::read_to_string(fixture.profile().join("user.js"))
            .unwrap()
            .contains("toolkit.legacyUserProfileCustomizations.stylesheets")
    );
    assert!(fixture.profile().join("chrome/userContent.css").is_file());
    for id in IDS {
        assert_eq!(
            fs::read(fixture.profile().join(format!("extensions/{id}.xpi"))).unwrap(),
            xpi(id)
        );
    }
    assert_eq!(
        fs::metadata(fixture.profile().join("user.js"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o640
    );
    let after = fixture.snapshot();
    success(&fixture.invoke("configure", None, None));
    assert_eq!(fixture.snapshot(), after);
    assert_eq!(fixture.downloads(), 4);
}

#[test]
fn native_default_resolution_prefers_install_then_profile_default_then_sole_profile() {
    for registry in [
        "[InstallABC]\nDefault=main.default-release\n[Profile0]\nPath=other\nIsRelative=1\nDefault=1\n",
        "[Profile0]\nPath=other\nIsRelative=1\n[Profile1]\nPath=main.default-release\nIsRelative=1\nDefault=1\n",
        "[Profile0]\nPath=main.default-release\nIsRelative=1\n",
        "[InstallABC]\nDefault=main.default-release\n[InstallDEF]\nDefault=main.default-release\n",
    ] {
        let fixture = Fixture::new();
        fixture.standard();
        fixture.registry(registry);
        assert_eq!(
            success(&fixture.invoke("configure", None, None))["profile"],
            json!(fixture.profile())
        );
    }
}

#[test]
fn explicit_profile_works_without_a_registry_and_preserves_other_profiles() {
    let fixture = Fixture::new();
    fixture.standard();
    fs::remove_file(fixture.profiles.join("profiles.ini")).unwrap();
    let selected = fixture.profiles.join("other");
    let before = fs::read(fixture.profile().join("prefs.js")).unwrap();
    assert_eq!(
        success(&fixture.invoke("configure", Some(&selected), None))["profile"],
        json!(selected)
    );
    assert_eq!(
        fs::read(fixture.profile().join("prefs.js")).unwrap(),
        before
    );
    assert!(!fixture.profile().join("user.js").exists());
    assert!(!fixture.profiles.join("profiles.ini").exists());
}

#[test]
fn supports_absolute_native_registry_profile_paths() {
    let fixture = Fixture::new();
    fixture.standard();
    fixture.registry(&format!(
        "[Profile0]\nPath={}\nIsRelative=0\nDefault=1\n",
        fixture.profile().display()
    ));
    assert_eq!(
        success(&fixture.invoke("configure", None, None))["profile"],
        json!(fixture.profile())
    );
}

#[test]
fn refuses_ambiguous_or_malformed_registry_selection_before_downloads() {
    for registry in [
        "[InstallABC]\nDefault=main.default-release\n[InstallDEF]\nDefault=other\n",
        "[Profile0]\nPath=main.default-release\nIsRelative=1\nDefault=1\n[Profile1]\nPath=other\nIsRelative=1\nDefault=1\n",
        "[Profile0]\nPath=main.default-release\nIsRelative=1\n[Profile1]\nPath=other\nIsRelative=1\n",
        "[Profile0]\nPath=../outside\nIsRelative=1\n",
        "[Profile0]\nPath=/tmp/outside\nIsRelative=1\n",
        "[Profile0]\nPath=main.default-release\nIsRelative=2\n",
        "[Profile0]\nPath=main.default-release\nPath=other\nIsRelative=1\n",
        "[Profile0]\nPath=main.default-release\nIsRelative=1\n[Profile0]\n",
        "not an INI document",
    ] {
        let fixture = Fixture::new();
        fixture.standard();
        fixture.registry(registry);
        let before = fixture.snapshot();
        assert!(
            fixture
                .invoke("configure", None, None)
                .contains("ZEN_ERROR:"),
            "{registry}"
        );
        assert_eq!(fixture.downloads(), 0);
        assert_eq!(fixture.snapshot(), before);
    }
}

#[test]
fn missing_default_is_skippable_but_explicit_configuration_requires_opening_zen_first() {
    let fixture = Fixture::new();
    assert_eq!(success(&fixture.invoke("exists", None, None)), json!(false));
    let error = fixture.invoke("configure", None, None);
    assert!(error.contains("open Zen once"), "{error}");
    assert!(!fixture.profiles.exists());
    fixture.registry("[Profile0]\nPath=main.default-release\nIsRelative=1\n");
    assert_eq!(success(&fixture.invoke("exists", None, None)), json!(false));
    write(
        fixture.profile().join("Bookmarks"),
        b"not enough to identify a profile",
    );
    assert_eq!(success(&fixture.invoke("exists", None, None)), json!(false));
    assert!(
        fixture
            .invoke("configure", Some(&fixture.profile()), None)
            .contains("profile does not exist")
    );
    assert!(!fixture.profile().join("prefs.js").exists());
    assert_eq!(fixture.downloads(), 0);
}

#[test]
fn active_posix_profile_lock_is_rejected_and_stale_lock_is_preserved() {
    let fixture = Fixture::new();
    fixture.standard();
    let lock_path = fixture.profile().join(".parentlock");
    write(lock_path.clone(), b"native stale lock contents");
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&lock_path)
        .unwrap();
    let mut record: libc::flock = unsafe { std::mem::zeroed() };
    record.l_type = libc::F_WRLCK as libc::c_short;
    record.l_whence = libc::SEEK_SET as libc::c_short;
    assert_eq!(
        unsafe { libc::fcntl(file.as_raw_fd(), libc::F_SETLK, &record) },
        0
    );
    let before = fixture.snapshot();
    let error = fixture.invoke("configure", None, None);
    assert!(error.contains("Close Zen"), "{error}");
    assert_eq!(fixture.snapshot(), before);
    assert_eq!(fixture.downloads(), 0);
    drop(file);
    symlink("browser-owned-native-lock", fixture.profile().join("lock")).unwrap();
    success(&fixture.invoke("configure", None, None));
    assert_eq!(fs::read(&lock_path).unwrap(), b"native stale lock contents");
    assert_eq!(
        fs::read_link(fixture.profile().join("lock")).unwrap(),
        PathBuf::from("browser-owned-native-lock")
    );
}

#[test]
fn cooperative_luna_lock_also_prevents_concurrent_configuration() {
    let fixture = Fixture::new();
    fixture.standard();
    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(fixture.profile().join(".luna-config.lock"))
        .unwrap();
    lock.try_lock().unwrap();
    assert!(
        fixture
            .invoke("configure", None, None)
            .contains("configuration is busy")
    );
    assert_eq!(fixture.downloads(), 0);
}

#[test]
fn rejects_symlinks_in_registry_profile_and_export_paths_without_touching_targets() {
    for relative in [
        "profiles.ini",
        "main.default-release/prefs.js",
        "main.default-release/user.js",
        "main.default-release/chrome",
        "main.default-release/extensions/uBlock0@raymondhill.net.xpi",
        "main.default-release/.parentlock",
        "main.default-release/.luna-config.lock",
    ] {
        let fixture = Fixture::new();
        fixture.standard();
        let path = fixture.profiles.join(relative);
        if path.is_file() {
            fs::remove_file(&path).unwrap();
        }
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let outside = fixture.root().join("outside");
        write(outside.clone(), b"must remain untouched");
        symlink(&outside, path).unwrap();
        let before = fixture.snapshot();
        let error = fixture.invoke("configure", None, None);
        assert!(
            error.contains("must not contain links"),
            "{relative}: {error}"
        );
        assert_eq!(fixture.snapshot(), before);
        assert_eq!(fs::read(outside).unwrap(), b"must remain untouched");
        assert_eq!(fixture.downloads(), 0);
    }
    let fixture = Fixture::new();
    fixture.standard();
    let linked = fixture.profiles.join("linked");
    symlink(fixture.profile(), &linked).unwrap();
    assert!(
        fixture
            .invoke("configure", Some(&linked), None)
            .contains("must not contain links")
    );
}

#[test]
fn external_edits_during_download_are_preserved_before_any_export_is_published() {
    for relative in [
        "main.default-release/prefs.js",
        "main.default-release/user.js",
        "main.default-release/chrome/userChrome.css",
        "main.default-release/extensions/uBlock0@raymondhill.net.xpi",
        "profiles.ini",
    ] {
        let fixture = Fixture::new();
        fixture.standard();
        let edited = fixture.profiles.join(relative);
        write(
            edited.clone(),
            if relative == "profiles.ini" {
                b"[Profile0]\nPath=main.default-release\nIsRelative=1\n"
            } else {
                b"original bytes"
            },
        );
        let mut before = fixture.snapshot();
        let error = fixture.invoke("configure", None, Some(&edited));
        assert!(error.contains("changed externally"), "{relative}: {error}");
        assert_eq!(fs::read(&edited).unwrap(), b"external editor bytes\n");
        before.insert(edited, b"external editor bytes\n".to_vec());
        assert_eq!(fixture.snapshot(), before);
        assert_eq!(fixture.downloads(), 2);
    }
}

#[test]
fn schema_provider_and_download_failures_do_not_replace_exports() {
    for failure in ["schema", "provider", "download", "package"] {
        let fixture = Fixture::new();
        fixture.standard();
        write(fixture.profile().join("user.js"), b"existing export");
        match failure {
            "schema" => write(fixture.settings.join("settings.conf"), b"extensions=[]"),
            "provider" => write(fixture.root().join("no-provider"), b""),
            "download" => write(fixture.root().join("download-fail"), b""),
            "package" => write(
                fixture.root().join(format!("fixtures/{}.xpi", IDS[0])),
                b"not an XPI",
            ),
            _ => unreachable!(),
        }
        let before = fixture.snapshot();
        assert!(
            fixture
                .invoke("configure", None, None)
                .contains("ZEN_ERROR:"),
            "{failure}"
        );
        assert_eq!(fixture.snapshot(), before);
    }
}

#[test]
fn rejects_profiles_overlapping_source_or_unsafe_explicit_paths() {
    let fixture = Fixture::new();
    fixture.standard();
    write(fixture.settings.join("prefs.js"), b"profile within source");
    assert!(
        fixture
            .invoke("configure", Some(&fixture.settings), None)
            .contains("overlaps app settings")
    );
    assert!(
        fixture
            .invoke("configure", Some(Path::new("/")), None)
            .contains("filesystem root")
    );
    assert!(
        fixture
            .invoke(
                "configure",
                Some(&fixture.profile().join("../main.default-release")),
                None
            )
            .contains("cannot contain '..'")
    );
    assert_eq!(fixture.downloads(), 0);
}

#[test]
fn from_env_follows_native_zen_root_selection_without_creating_a_second_root() {
    for existing_home_root in [false, true] {
        let fixture = Fixture::new();
        fixture.standard();
        let root = if existing_home_root {
            fixture.root().join("home/.zen")
        } else {
            fixture.root().join("config/zen")
        };
        fs::create_dir_all(root.parent().unwrap()).unwrap();
        fs::rename(&fixture.profiles, &root).unwrap();
        assert_eq!(
            success(&fixture.invoke("environment", None, None))["profile"],
            json!(root.join("main.default-release"))
        );
        assert!(!fixture.profiles.exists());
        if existing_home_root {
            assert!(!fixture.root().join("config/zen").exists());
        } else {
            assert!(!fixture.root().join("home/.zen").exists());
        }
    }
}

#[test]
fn configure_in_child() {
    let Some(root) = std::env::var_os("LUNA_ZEN_TEST_PROFILES") else {
        return;
    };
    let action = std::env::var("LUNA_ZEN_TEST_ACTION").unwrap();
    let result = (if action == "environment" {
        Zen::from_env()
    } else {
        Zen::new(Paths {
            profiles_dir: root.into(),
        })
    })
    .and_then(|zen| {
        if action == "exists" {
            return Ok(json!(zen.default_profile_exists()?));
        }
        let config = PathBuf::from(std::env::var_os("LUNA_ZEN_TEST_SETTINGS").unwrap());
        let profile = std::env::var_os("LUNA_ZEN_TEST_PROFILE").map(PathBuf::from);
        Ok(serde_json::to_value(
            zen.configure_profile(&config, profile.as_deref())?,
        )?)
    });
    match result {
        Ok(configured) => println!("ZEN_OK: {}", serde_json::to_string(&configured).unwrap()),
        Err(error) => println!("ZEN_ERROR: {error}"),
    }
}
