use std::{
    collections::BTreeMap,
    fs,
    io::{Cursor, Write},
    os::unix::fs::{PermissionsExt, symlink},
    path::{Path, PathBuf},
    process::Command,
};

use luna_next::chromium::{Chromium, Paths};
use serde_json::{Value, json};

const OWNER: &[u8] = b"Luna Next Chromium\n";
const EXTERNAL_PREFERENCES: &str =
    "{\"external_editor\":true,\"profile\":{\"name\":\"Keep this edit\"}}\n";

struct Fixture {
    temporary: tempfile::TempDir,
    paths: Paths,
    settings: PathBuf,
    log: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path();
        let settings = root.join("settings");
        let bin = root.join("bin");
        fs::create_dir(&settings).unwrap();
        fs::create_dir(&bin).unwrap();
        fs::create_dir(root.join("home")).unwrap();
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/chromium/config");
        for name in ["settings.conf", "settings.schema.json"] {
            fs::copy(source.join(name), settings.join(name)).unwrap();
        }
        fs::write(root.join("fixture.crx"), crx()).unwrap();
        for (name, body) in [
            (
                "pacman",
                "[ \"$*\" = '-Q ungoogled-chromium-bin' ] || exit 32\nprintf '%s\\n' 'ungoogled-chromium-bin 156.0.8078.73-1'\n",
            ),
            (
                "chromium",
                "[ \"$*\" = --version ] || exit 33\nprintf '%s\\n' 'Chromium 156.0.8078.73'\n",
            ),
            (
                "git",
                "[ \"$*\" = 'config --global --get user.name' ] || exit 34\nprintf '%s\\n' 'Test Name / नमस्ते'\n",
            ),
            (
                "curl",
                r#"while [ "$#" -gt 0 ]; do
    if [ "$1" = --output ]; then shift; destination=$1; fi
    shift
done
/usr/bin/cp "$LUNA_CHROMIUM_TEST_FIXTURE" "$destination" || exit 35
if [ -n "$LUNA_CHROMIUM_TEST_EDIT" ]; then
    printf '%s\n' '{"external_editor":true,"profile":{"name":"Keep this edit"}}' > "$LUNA_CHROMIUM_TEST_EDIT"
fi
"#,
            ),
        ] {
            let path = bin.join(name);
            fs::write(
                &path,
                format!(
                    "#!/bin/sh\nprintf '%s\\n' \"${{0##*/}}\" >> \"$LUNA_CHROMIUM_TEST_LOG\"\n{body}"
                ),
            )
            .unwrap();
            fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
        }
        let paths = Paths {
            user_data_dir: root.join("managed"),
            launcher: root.join("launch/luna-chromium"),
            desktop_file: root.join("applications/luna-chromium.desktop"),
        };
        write(root.join("outside/keep"), b"outside bytes\n");
        write(
            root.join("home/.config/chromium/Default/Preferences"),
            b"existing default profile bytes\n",
        );
        let log = root.join("commands");
        Self {
            temporary,
            paths,
            settings,
            log,
        }
    }

    fn root(&self) -> &Path {
        self.temporary.path()
    }

    fn owned(&self) {
        write(self.paths.user_data_dir.join(".luna-managed"), OWNER);
        write(
            self.preferences(),
            b"{\"profile\":{\"name\":\"Existing name\"}}\n",
        );
        write(self.paths.user_data_dir.join("Local State"), b"{}\n");
        write(&self.paths.launcher, b"previous launcher\n");
        write(&self.paths.desktop_file, b"previous desktop entry\n");
        write(
            self.paths.user_data_dir.join("Default/Bookmarks"),
            b"managed bookmarks\n",
        );
    }

    fn preferences(&self) -> PathBuf {
        self.paths.user_data_dir.join("Default/Preferences")
    }

    fn explicit_profile(&self) -> PathBuf {
        let root = self.root().join("external");
        let profile = root.join("Profile 2");
        write(
            profile.join("Preferences"),
            b"{\"profile\":{\"name\":\"Personal\"}}\n",
        );
        write(root.join("Local State"), b"{\"keep\":true}\n");
        write(root.join("Default/Bookmarks"), b"unselected bookmarks\n");
        profile
    }

    fn configure(&self, edit_preferences: bool) -> String {
        self.operation("configure", None, edit_preferences)
    }

    fn operation(&self, action: &str, profile: Option<&Path>, edit_preferences: bool) -> String {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args(["--exact", "configure_in_child", "--nocapture"])
            .env_clear()
            .env("HOME", self.root().join("home"))
            .env("XDG_CONFIG_HOME", self.root().join("config"))
            .env("XDG_DATA_HOME", self.root().join("data"))
            .env("PATH", self.root().join("bin"))
            .env("LUNA_CHROMIUM_TEST_ACTION", action)
            .env("LUNA_CHROMIUM_TEST_ROOT", &self.paths.user_data_dir)
            .env("LUNA_CHROMIUM_TEST_LAUNCHER", &self.paths.launcher)
            .env("LUNA_CHROMIUM_TEST_DESKTOP", &self.paths.desktop_file)
            .env("LUNA_CHROMIUM_TEST_SETTINGS", &self.settings)
            .env(
                "LUNA_CHROMIUM_TEST_FIXTURE",
                self.root().join("fixture.crx"),
            )
            .env("LUNA_CHROMIUM_TEST_LOG", &self.log);
        if let Some(profile) = profile {
            command.env("LUNA_CHROMIUM_TEST_PROFILE", profile);
        }
        if edit_preferences {
            command.env("LUNA_CHROMIUM_TEST_EDIT", self.preferences());
        }
        let output = command.output().unwrap();
        assert!(
            output.status.success(),
            "child test failed:\n{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let output = String::from_utf8(output.stdout).unwrap();
        assert!(
            output.contains("CHROMIUM_ERROR:") || output.contains("CHROMIUM_OK:"),
            "{output}"
        );
        output
    }

    fn downloads(&self) -> usize {
        fs::read_to_string(&self.log)
            .unwrap_or_default()
            .lines()
            .filter(|line| *line == "curl")
            .count()
    }

    fn snapshot(&self) -> BTreeMap<PathBuf, Entry> {
        let mut entries = BTreeMap::new();
        for path in [
            &self.paths.user_data_dir,
            &self.paths.launcher,
            &self.paths.desktop_file,
            &self.root().join("outside"),
            &self.root().join("external"),
            &self.root().join("home/.config/chromium"),
        ] {
            capture(path, &mut entries);
        }
        entries
    }
}

#[derive(Debug, PartialEq, Eq)]
enum Entry {
    Directory,
    File(Vec<u8>, u32),
    Link(PathBuf),
}

fn capture(path: &Path, entries: &mut BTreeMap<PathBuf, Entry>) {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
        Err(error) => panic!("{}: {error}", path.display()),
    };
    let entry = if metadata.is_symlink() {
        Entry::Link(fs::read_link(path).unwrap())
    } else if metadata.is_dir() {
        for child in fs::read_dir(path).unwrap() {
            capture(&child.unwrap().path(), entries);
        }
        Entry::Directory
    } else {
        Entry::File(
            fs::read(path).unwrap(),
            metadata.permissions().mode() & 0o777,
        )
    };
    entries.insert(path.into(), entry);
}

fn write(path: impl AsRef<Path>, bytes: &[u8]) {
    let path = path.as_ref();
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, bytes).unwrap();
}

fn crx() -> Vec<u8> {
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    zip.start_file("manifest.json", zip::write::SimpleFileOptions::default())
        .unwrap();
    zip.write_all(br#"{"name":"Fixture","manifest_version":3,"version":"1.2.3"}"#)
        .unwrap();
    let mut bytes = b"Cr24".to_vec();
    bytes.extend(3u32.to_le_bytes());
    bytes.extend(2u32.to_le_bytes());
    bytes.extend([0x0a, 0x00]);
    bytes.extend(zip.finish().unwrap().into_inner());
    bytes
}

fn success(output: &str) -> Value {
    let result = output
        .lines()
        .find_map(|line| line.strip_prefix("CHROMIUM_OK: "))
        .unwrap_or_else(|| panic!("expected success: {output}"));
    serde_json::from_str(result).unwrap()
}

#[test]
fn creates_only_a_git_named_profile_and_launcher_without_configuration() {
    let fixture = Fixture::new();
    let settings = fs::read(fixture.settings.join("settings.conf")).unwrap();
    let created = success(&fixture.operation("create", None, false));
    assert_eq!(
        created["directory"],
        json!(fixture.paths.user_data_dir.join("Default"))
    );
    assert_eq!(created["name"], "Test Name / नमस्ते");
    assert_eq!(created["launcher"], json!(fixture.paths.launcher));
    let preferences: Value =
        serde_json::from_slice(&fs::read(fixture.preferences()).unwrap()).unwrap();
    assert_eq!(
        preferences,
        json!({"profile": {"name": "Test Name / नमस्ते", "using_default_name": false}})
    );
    assert_eq!(
        fs::read(fixture.paths.user_data_dir.join(".luna-managed")).unwrap(),
        OWNER
    );
    assert!(fixture.paths.launcher.is_file());
    assert!(fixture.paths.desktop_file.is_file());
    assert!(
        !fixture
            .paths
            .user_data_dir
            .join("Default/Luna Next")
            .exists()
    );
    assert!(!fixture.root().join("config").exists());
    assert!(!fixture.root().join("data").exists());
    assert_eq!(fixture.downloads(), 0);
    assert_eq!(
        fs::read(fixture.settings.join("settings.conf")).unwrap(),
        settings
    );
    assert_eq!(
        fs::read(
            fixture
                .root()
                .join("home/.config/chromium/Default/Preferences")
        )
        .unwrap(),
        b"existing default profile bytes\n"
    );
}

#[test]
fn repeated_profile_creation_preserves_customized_profile_bytes_and_permissions() {
    let fixture = Fixture::new();
    success(&fixture.operation("create", None, false));
    write(
        fixture.preferences(),
        b"{\"profile\":{\"name\":\"Personal\"},\"custom\":true}\n",
    );
    fs::set_permissions(fixture.preferences(), fs::Permissions::from_mode(0o640)).unwrap();
    write(
        fixture.paths.user_data_dir.join("Default/Bookmarks"),
        b"personal bookmarks",
    );
    let before = fixture.snapshot();
    let created = success(&fixture.operation("create", None, false));
    assert_eq!(created["name"], "Personal");
    assert_eq!(fixture.snapshot(), before);
    assert_eq!(
        fs::read_to_string(&fixture.log)
            .unwrap()
            .lines()
            .filter(|line| *line == "git")
            .count(),
        1
    );
    assert_eq!(fixture.downloads(), 0);
}

#[test]
fn explicit_profile_creation_preserves_other_profiles_without_claiming_the_root() {
    let fixture = Fixture::new();
    let root = fixture.root().join("external");
    let profile = root.join("Profile 2");
    write(root.join("Default/Bookmarks"), b"existing bookmarks");
    write(root.join("Local State"), b"{\"keep\":true}\n");
    let created = success(&fixture.operation("create", Some(&profile), false));
    assert_eq!(created["directory"], json!(profile));
    assert_eq!(created["launcher"], Value::Null);
    assert!(profile.join("Preferences").is_file());
    assert!(!root.join(".luna-managed").exists());
    assert!(!profile.join("Luna Next").exists());
    assert!(!fixture.paths.user_data_dir.exists());
    assert!(!fixture.paths.launcher.exists());
    assert!(!fixture.paths.desktop_file.exists());
    assert_eq!(
        fs::read(root.join("Default/Bookmarks")).unwrap(),
        b"existing bookmarks"
    );
    assert_eq!(
        fs::read(root.join("Local State")).unwrap(),
        b"{\"keep\":true}\n"
    );
    assert_eq!(fixture.downloads(), 0);
}

#[test]
fn configuration_requires_an_existing_selected_profile_without_creating_any_outputs() {
    for explicit in [false, true] {
        let fixture = Fixture::new();
        let profile = fixture.root().join("external/Profile 2");
        let before = fixture.snapshot();
        let error = fixture.operation("configure", explicit.then_some(profile.as_path()), false);
        assert!(error.contains("profile does not exist"), "{error}");
        assert!(error.contains("luna chromium create-profile"), "{error}");
        assert_eq!(fixture.snapshot(), before);
        assert!(!fixture.log.exists());
        assert!(!fixture.root().join("config").exists());
        assert!(!fixture.root().join("data").exists());
    }
}

#[test]
fn rejects_malformed_browser_json_and_wrong_shaped_preferences_before_downloads() {
    for (file, contents, expected) in [
        ("Default/Preferences", "{", "EOF"),
        ("Default/Preferences", "[]", "must be a JSON object"),
        ("Default/Preferences", "null", "must be a JSON object"),
        ("Local State", "{", "EOF"),
        ("Local State", "[]", "must be a JSON object"),
        (
            "Default/Preferences",
            r#"{"webkit":[]}"#,
            "'webkit' must be an object",
        ),
        (
            "Default/Preferences",
            r#"{"webkit":{"webprefs":null}}"#,
            "'webprefs' must be an object",
        ),
        (
            "Default/Preferences",
            r#"{"webkit":{"webprefs":{"fonts":false}}}"#,
            "'fonts' must be an object",
        ),
        (
            "Default/Preferences",
            r#"{"webkit":{"webprefs":{"fonts":{"fixed":[]}}}}"#,
            "'fixed' must be an object",
        ),
    ] {
        let fixture = Fixture::new();
        fixture.owned();
        write(fixture.paths.user_data_dir.join(file), contents.as_bytes());
        let before = fixture.snapshot();
        let error = fixture.configure(false);
        assert!(error.contains(expected), "{file} {contents}: {error}");
        assert_eq!(fixture.downloads(), 0);
        assert_eq!(fixture.snapshot(), before);
    }
}

#[test]
fn refuses_to_adopt_an_unowned_profile_with_the_same_display_name() {
    let fixture = Fixture::new();
    write(
        fixture.preferences(),
        "{\"profile\":{\"name\":\"Test Name / नमस्ते\"}}\n".as_bytes(),
    );
    write(
        fixture.paths.user_data_dir.join("Default/Bookmarks"),
        b"personal bookmarks",
    );
    let before = fixture.snapshot();
    assert!(fixture.configure(false).contains("Refusing to adopt"));
    assert_eq!(fixture.downloads(), 0);
    assert_eq!(fixture.snapshot(), before);
}

#[test]
fn refuses_unknown_owner_markers_before_downloads_or_publication() {
    let fixture = Fixture::new();
    fixture.owned();
    write(
        fixture.paths.user_data_dir.join(".luna-managed"),
        b"someone else\n",
    );
    let before = fixture.snapshot();
    assert!(
        fixture
            .configure(false)
            .contains("unowned Chromium profile")
    );
    assert_eq!(fixture.downloads(), 0);
    assert_eq!(fixture.snapshot(), before);
}

#[test]
fn explicit_profile_needs_no_owner_marker_but_rejects_invalid_preferences() {
    for (contents, expected) in [
        ("{", "EOF"),
        ("[]", "must be a JSON object"),
        (r#"{"webkit":null}"#, "'webkit' must be an object"),
    ] {
        let fixture = Fixture::new();
        let profile = fixture.explicit_profile();
        write(profile.join("Preferences"), contents.as_bytes());
        let before = fixture.snapshot();
        let error = fixture.operation("configure", Some(&profile), false);
        assert!(error.contains(expected), "{contents}: {error}");
        assert!(!error.contains("unowned"), "{error}");
        assert!(!profile.parent().unwrap().join(".luna-managed").exists());
        assert_eq!(fixture.downloads(), 0);
        assert_eq!(fixture.snapshot(), before);
    }
}

#[test]
fn explicit_profile_respects_its_user_data_root_singleton_lock() {
    let fixture = Fixture::new();
    let profile = fixture.explicit_profile();
    symlink(
        format!("machine-{}", std::process::id()),
        profile.parent().unwrap().join("SingletonLock"),
    )
    .unwrap();
    let before = fixture.snapshot();
    let error = fixture.operation("configure", Some(&profile), false);
    assert!(error.contains("SingletonLock"), "{error}");
    assert_eq!(fixture.downloads(), 0);
    assert_eq!(fixture.snapshot(), before);
    assert!(!fixture.log.exists());
}

#[test]
fn preserves_live_and_stale_singleton_locks() {
    for (name, link) in [
        (
            "SingletonLock",
            Some(format!("machine-{}", std::process::id())),
        ),
        ("SingletonLock", Some("machine-999999999".into())),
        ("SingletonLock", None),
        ("SingletonSocket", Some("missing-socket".into())),
        ("SingletonCookie", None),
    ] {
        let fixture = Fixture::new();
        fixture.owned();
        let path = fixture.paths.user_data_dir.join(name);
        if let Some(target) = link {
            symlink(target, path).unwrap();
        } else {
            write(path, b"browser-owned lock\n");
        }
        let before = fixture.snapshot();
        assert!(fixture.configure(false).contains(name));
        assert_eq!(fixture.downloads(), 0);
        assert_eq!(fixture.snapshot(), before);
    }
}

#[test]
fn rejects_symlinks_in_destinations_and_browser_state_without_following_them() {
    for destination in [
        "managed",
        "launch/luna-chromium",
        "applications/luna-chromium.desktop",
        "managed/Default/Preferences",
        "managed/Local State",
    ] {
        let fixture = Fixture::new();
        fixture.owned();
        let path = fixture.root().join(destination);
        if path.is_dir() {
            fs::remove_dir_all(&path).unwrap();
        } else if path.exists() {
            fs::remove_file(&path).unwrap();
        }
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        symlink(fixture.root().join("outside"), path).unwrap();
        let before = fixture.snapshot();
        assert!(fixture.configure(false).contains("must not contain links"));
        assert_eq!(fixture.downloads(), 0);
        assert_eq!(fixture.snapshot(), before);
    }
}

#[test]
fn explicit_profile_rejects_symlink_paths_without_touching_their_targets() {
    let fixture = Fixture::new();
    let profile = fixture.explicit_profile();
    let linked = profile.with_file_name("Linked Profile");
    symlink(&profile, &linked).unwrap();
    let before = fixture.snapshot();
    let error = fixture.operation("configure", Some(&linked), false);
    assert!(error.contains("must not contain links"), "{error}");
    assert_eq!(fixture.downloads(), 0);
    assert_eq!(fixture.snapshot(), before);
    assert!(!fixture.log.exists());
}

#[test]
fn explicit_profile_cannot_overlap_app_settings_or_launch_entries() {
    let fixture = Fixture::new();
    write(fixture.settings.join("Preferences"), b"{}\n");
    let error = fixture.operation("configure", Some(&fixture.settings), false);
    assert!(error.contains("overlaps app settings"), "{error}");
    assert_eq!(
        fs::read(fixture.settings.join("Preferences")).unwrap(),
        b"{}\n"
    );
    let error = fixture.operation("configure", fixture.paths.launcher.parent(), false);
    assert!(error.contains("overlaps its launch entries"), "{error}");
    assert_eq!(fixture.downloads(), 0);
    assert!(!fixture.paths.user_data_dir.exists());
}

#[test]
fn rejects_empty_overlapping_and_parent_component_paths() {
    let fixture = Fixture::new();
    let mut invalid = fixture.paths.clone();
    invalid.user_data_dir = PathBuf::new();
    assert!(Chromium::new(invalid).is_err());
    let mut invalid = fixture.paths.clone();
    invalid.launcher = invalid.user_data_dir.join("launcher");
    assert!(Chromium::new(invalid).is_err());
    let mut invalid = fixture.paths.clone();
    invalid.desktop_file = invalid.launcher.clone();
    assert!(Chromium::new(invalid).is_err());
    let mut invalid = fixture.paths.clone();
    invalid.user_data_dir = PathBuf::from("/");
    assert!(Chromium::new(invalid).is_err());
    let mut invalid = fixture.paths.clone();
    invalid.launcher = fixture.root().join("child/../launcher");
    assert!(Chromium::new(invalid).is_err());
    assert_eq!(fixture.downloads(), 0);
}

#[test]
fn rejects_app_schema_errors_before_downloads_and_output_changes() {
    for value in [
        "extensions = []",
        "extensions = [\"bad-id\"]",
        "extensions = [42]",
        "extensions = [\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\", \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"]",
        "extensions = [\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"]\nunknown = true",
    ] {
        let fixture = Fixture::new();
        fixture.owned();
        write(fixture.settings.join("settings.conf"), value.as_bytes());
        let before = fixture.snapshot();
        let error = fixture.configure(false);
        assert!(error.contains("CHROMIUM_ERROR:"), "{value}: {error}");
        assert_eq!(fixture.downloads(), 0);
        assert_eq!(fixture.snapshot(), before);
        assert!(
            !fixture.log.exists(),
            "schema validation must precede commands"
        );
    }
}

#[test]
fn external_edit_during_download_preserves_the_edit_and_all_other_outputs() {
    let fixture = Fixture::new();
    fixture.owned();
    write(
        fixture
            .paths
            .user_data_dir
            .join("Default/Luna Next/keep.crx"),
        b"old package",
    );
    write(
        fixture
            .paths
            .user_data_dir
            .join("Default/Luna Next/keep.json"),
        b"old descriptor",
    );
    let mut before = fixture.snapshot();
    let error = fixture.configure(true);
    assert!(error.contains("changed externally"), "{error}");
    assert_eq!(fixture.downloads(), 4);
    assert_eq!(
        fs::read_to_string(fixture.preferences()).unwrap(),
        EXTERNAL_PREFERENCES
    );
    before.remove(&fixture.preferences());
    let mut after = fixture.snapshot();
    after.remove(&fixture.preferences());
    assert_eq!(after, before);
}

#[test]
fn configure_in_child() {
    let Some(root) = std::env::var_os("LUNA_CHROMIUM_TEST_ROOT") else {
        return;
    };
    let result = Chromium::new(Paths {
        user_data_dir: root.into(),
        launcher: std::env::var_os("LUNA_CHROMIUM_TEST_LAUNCHER")
            .unwrap()
            .into(),
        desktop_file: std::env::var_os("LUNA_CHROMIUM_TEST_DESKTOP")
            .unwrap()
            .into(),
    })
    .and_then(|chromium| {
        let profile = std::env::var_os("LUNA_CHROMIUM_TEST_PROFILE").map(PathBuf::from);
        match std::env::var("LUNA_CHROMIUM_TEST_ACTION").unwrap().as_str() {
            "create" => Ok(serde_json::to_value(
                chromium.create_profile(profile.as_deref())?,
            )?),
            "configure" => {
                let config =
                    PathBuf::from(std::env::var_os("LUNA_CHROMIUM_TEST_SETTINGS").unwrap());
                Ok(serde_json::to_value(match profile {
                    Some(profile) => chromium.configure_profile(&config, Some(&profile))?,
                    None => chromium.configure(&config)?,
                })?)
            }
            action => panic!("unknown fixture action: {action}"),
        }
    });
    match result {
        Ok(configured) => println!(
            "CHROMIUM_OK: {}",
            serde_json::to_string(&configured).unwrap()
        ),
        Err(error) => println!("CHROMIUM_ERROR: {error}"),
    }
}
