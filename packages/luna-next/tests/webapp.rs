use std::{
    fs,
    os::unix::fs::{PermissionsExt, symlink},
    path::{Path, PathBuf},
    process::Command,
};

use luna_next::webapp::{Paths, Webapps};
use serde_json::Value;

struct Fixture {
    temporary: tempfile::TempDir,
    paths: Paths,
}

impl Fixture {
    fn new() -> Self {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path();
        let bin = root.join("bin");
        fs::create_dir(&bin).unwrap();
        for (name, body) in [
            (
                "pacman",
                "[ ! -e \"$LUNA_WEBAPP_FIXTURE/no-provider\" ] || exit 1\nprintf '%s\\n' 'ungoogled-chromium-bin 156.0.8078.73-1'\n",
            ),
            (
                "chromium",
                "[ \"$*\" = --version ] || exit 78\nprintf '%s\\n' 'Chromium 156.0.8078.73'\n",
            ),
            ("file", "exec /usr/bin/file \"$@\"\n"),
            (
                "curl",
                r#"[ ! -e "$LUNA_WEBAPP_FIXTURE/fail-download" ] || exit 22
while [ "$#" -gt 0 ]; do
    case "$1" in
        --output) shift; destination=$1;;
        --url) shift; url=$1;;
    esac
    shift
done
case "$url" in
    */icon.png) /usr/bin/cp "$LUNA_WEBAPP_FIXTURE/icon.png" "$destination";;
    *) printf '%s' '<html><head><link rel="icon" href="/icon.png"></head></html>' > "$destination";;
esac
printf '%s' "$url"
"#,
            ),
        ] {
            executable(&bin.join(name), &format!("#!/bin/sh\n{body}"));
        }
        // A genuine PNG keeps type detection on the real `file` path.
        let png = [
            137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
            8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 11, 73, 68, 65, 84, 120, 156, 99, 96, 0, 2,
            0, 0, 5, 0, 1, 165, 246, 69, 64, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
        ];
        fs::write(root.join("icon.png"), png).unwrap();
        let launcher = root.join("bin/luna quoted\"$`%\\");
        executable(
            &launcher,
            &format!(
                "#!/usr/bin/python3\nimport json, pathlib, sys\npathlib.Path({:?}).write_text(json.dumps(sys.argv[1:]))\n",
                root.join("launched.json").to_str().unwrap()
            ),
        );
        Self {
            paths: Paths {
                applications_dir: root.join("data/applications"),
                data_dir: root.join("data/luna-next/webapps"),
                launcher,
            },
            temporary,
        }
    }

    fn root(&self) -> &Path {
        self.temporary.path()
    }

    fn default_profile(&self) -> PathBuf {
        self.root().join("config/luna-next/chromium/Default")
    }

    fn owned_profile(&self) {
        let profile = self.default_profile();
        write(
            profile.join("Preferences"),
            br#"{"profile":{"name":"Luna"},"keep":true}"#,
        );
        write(
            profile.parent().unwrap().join(".luna-managed"),
            b"Luna Next Chromium\n",
        );
        write(profile.parent().unwrap().join("Local State"), b"{}\n");
    }

    fn install(&self, name: &str, url: &str, profile: Option<&Path>) -> Result<Value, String> {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args(["--exact", "install_in_child", "--nocapture"])
            .env_clear()
            .env("HOME", self.root().join("home"))
            .env("PATH", self.root().join("bin"))
            .env("XDG_CONFIG_HOME", self.root().join("config"))
            .env("XDG_DATA_HOME", self.root().join("data"))
            .env("LUNA_WEBAPP_FIXTURE", self.root())
            .env("LUNA_WEBAPP_NAME", name)
            .env("LUNA_WEBAPP_URL", url)
            .env("LUNA_WEBAPP_LAUNCHER", &self.paths.launcher)
            .env("LUNA_WEBAPP_APPLICATIONS", &self.paths.applications_dir)
            .env("LUNA_WEBAPP_DATA", &self.paths.data_dir);
        if let Some(profile) = profile {
            command.env("LUNA_WEBAPP_PROFILE", profile);
        }
        let output = command.output().unwrap();
        assert!(output.status.success(), "{:?}", output);
        assert!(output.stderr.is_empty(), "{:?}", output.stderr);
        let stdout = String::from_utf8(output.stdout).unwrap();
        for line in stdout.lines() {
            if let Some(value) = line.strip_prefix("WEBAPP_OK: ") {
                return Ok(serde_json::from_str(value).unwrap());
            }
            if let Some(error) = line.strip_prefix("WEBAPP_ERROR: ") {
                return Err(error.to_owned());
            }
        }
        panic!("missing result: {stdout}")
    }
}

fn executable(path: &Path, contents: &str) {
    write(path, contents.as_bytes());
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
}

fn write(path: impl AsRef<Path>, contents: &[u8]) {
    let path = path.as_ref();
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, contents).unwrap();
}

fn path<'a>(result: &'a Value, key: &str) -> &'a Path {
    Path::new(result[key].as_str().unwrap())
}

#[test]
fn install_in_child() {
    let Some(launcher) = std::env::var_os("LUNA_WEBAPP_LAUNCHER") else {
        return;
    };
    let operation = || {
        let webapps = Webapps::new(Paths {
            applications_dir: std::env::var_os("LUNA_WEBAPP_APPLICATIONS").unwrap().into(),
            data_dir: std::env::var_os("LUNA_WEBAPP_DATA").unwrap().into(),
            launcher: launcher.into(),
        })?;
        let profile = std::env::var_os("LUNA_WEBAPP_PROFILE").map(PathBuf::from);
        webapps.install(
            &std::env::var("LUNA_WEBAPP_NAME").unwrap(),
            &std::env::var("LUNA_WEBAPP_URL").unwrap(),
            profile.as_deref(),
            None,
        )
    };
    match operation() {
        Ok(result) => println!("WEBAPP_OK: {}", serde_json::to_string(&result).unwrap()),
        Err(error) => println!("WEBAPP_ERROR: {error}"),
    }
}

#[test]
fn install_reuses_active_default_profile_without_browser_mutation() {
    let fixture = Fixture::new();
    fixture.owned_profile();
    let root = fixture.default_profile().parent().unwrap().to_owned();
    symlink("running-browser", root.join("SingletonLock")).unwrap();
    let preferences = fs::read(fixture.default_profile().join("Preferences")).unwrap();
    let installed = fixture
        .install("YouTube", "https://youtube.com/", None)
        .unwrap();
    assert_eq!(path(&installed, "profile"), fixture.default_profile());
    assert_eq!(
        fs::read(path(&installed, "icon")).unwrap(),
        fs::read(fixture.root().join("icon.png")).unwrap()
    );
    let entry = fs::read_to_string(path(&installed, "desktop_file")).unwrap();
    assert!(!entry.contains("--profile"));
    assert!(entry.contains("webapp launch"));
    assert_eq!(
        fs::read(fixture.default_profile().join("Preferences")).unwrap(),
        preferences
    );
    assert_eq!(
        fs::read_link(root.join("SingletonLock")).unwrap(),
        Path::new("running-browser")
    );
    assert!(!fixture.root().join("launched.json").exists());
}

#[test]
fn reinstall_replaces_declared_assets_and_preserves_old_exports_on_download_failure() {
    let fixture = Fixture::new();
    fixture.owned_profile();
    let installed = fixture.install("X", "https://x.com/", None).unwrap();
    let assets = path(&installed, "icon").parent().unwrap();
    fs::write(assets.join("obsolete"), b"removed on reinstall").unwrap();
    let updated = fixture.install("X", "https://x.com/home", None).unwrap();
    assert_eq!(updated["desktop_file"], installed["desktop_file"]);
    assert!(!assets.join("obsolete").exists());
    let desktop = fs::read(path(&updated, "desktop_file")).unwrap();
    let icon = fs::read(path(&updated, "icon")).unwrap();
    fs::write(fixture.root().join("fail-download"), b"").unwrap();
    assert!(fixture.install("X", "https://x.com/new", None).is_err());
    assert_eq!(fs::read(path(&updated, "desktop_file")).unwrap(), desktop);
    assert_eq!(fs::read(path(&updated, "icon")).unwrap(), icon);
}

#[test]
fn distinct_names_do_not_collide_after_slug_normalization() {
    let fixture = Fixture::new();
    fixture.owned_profile();
    let first = fixture
        .install("YouTube Music", "https://music.youtube.com/", None)
        .unwrap();
    let second = fixture
        .install("YouTube-Music", "https://music.youtube.com/", None)
        .unwrap();
    assert_ne!(first["desktop_file"], second["desktop_file"]);
    assert!(path(&first, "desktop_file").is_file());
    assert!(path(&second, "desktop_file").is_file());
}

#[test]
fn missing_profile_or_provider_leaves_exports_uncreated() {
    let fixture = Fixture::new();
    assert!(
        fixture
            .install("Example", "https://example.com/", None)
            .unwrap_err()
            .contains("create-profile")
    );
    assert!(!fixture.paths.applications_dir.exists());
    assert!(!fixture.paths.data_dir.exists());
    fixture.owned_profile();
    fs::write(fixture.root().join("no-provider"), b"").unwrap();
    assert!(
        fixture
            .install("Example", "https://example.com/", None)
            .unwrap_err()
            .contains("ungoogled-chromium-bin")
    );
    assert!(!fixture.paths.applications_dir.exists());
    assert!(!fixture.paths.data_dir.exists());
}

#[test]
fn symlinked_exports_and_browser_data_overlaps_are_rejected() {
    let mut fixture = Fixture::new();
    fixture.owned_profile();
    let outside = fixture.root().join("outside");
    fs::create_dir(&outside).unwrap();
    fs::create_dir_all(fixture.paths.data_dir.parent().unwrap()).unwrap();
    symlink(&outside, &fixture.paths.data_dir).unwrap();
    assert!(
        fixture
            .install("Example", "https://example.com/", None)
            .unwrap_err()
            .contains("links")
    );
    assert!(fs::read_dir(&outside).unwrap().next().is_none());
    fs::remove_file(&fixture.paths.data_dir).unwrap();
    fixture.paths.data_dir = fixture.default_profile().join("webapps");
    assert!(
        fixture
            .install("Example", "https://example.com/", None)
            .unwrap_err()
            .contains("overlap Chromium")
    );
    assert!(!fixture.default_profile().join("webapps").exists());
}

#[test]
fn rejects_invalid_names_urls_and_desktop_executable_paths() {
    let fixture = Fixture::new();
    fixture.owned_profile();
    for name in ["", "bad\nname", &"x".repeat(101)] {
        assert!(fixture.install(name, "https://example.com/", None).is_err());
    }
    for url in [
        "file:///tmp/a",
        "https://user:pass@example.com/",
        "https://example.com/%0A",
    ] {
        assert!(fixture.install("Example", url, None).is_err());
    }
    let mut paths = fixture.paths.clone();
    paths.launcher = fixture.root().join("bin/luna=invalid");
    executable(&paths.launcher, "#!/bin/sh\nexit 0\n");
    assert!(
        Webapps::new(paths)
            .err()
            .unwrap()
            .to_string()
            .contains("'='")
    );
    assert!(!fixture.paths.applications_dir.exists());
}

#[test]
fn desktop_launch_roundtrips_special_characters_and_exact_profile_through_gio() {
    let fixture = Fixture::new();
    let profile = fixture.root().join("external 'quoted' $`%\\/Profile \"2\"");
    write(
        profile.join("Preferences"),
        b"{\"profile\":{\"name\":\"Other\"}}\n",
    );
    write(profile.parent().unwrap().join("Local State"), b"{}\n");
    let installed = fixture
        .install(
            "Literal \\ name %f",
            "https://example.com/path%20with?q=%25&x=%22$`",
            Some(&profile),
        )
        .unwrap();
    let output = Command::new("/usr/bin/python3")
        .args([
            "-c",
            r#"
import gi, json, pathlib, sys, time
gi.require_version('Gio', '2.0')
from gi.repository import Gio
entry = Gio.DesktopAppInfo.new_from_filename(sys.argv[1])
assert entry is not None
assert entry.get_name() == sys.argv[3], entry.get_name()
assert entry.get_icon().to_string() == sys.argv[4], entry.get_icon().to_string()
entry.launch([], None)
trace = pathlib.Path(sys.argv[2])
for _ in range(100):
    if trace.exists(): break
    time.sleep(0.02)
assert trace.exists()
print(trace.read_text())
"#,
        ])
        .arg(path(&installed, "desktop_file"))
        .arg(fixture.root().join("launched.json"))
        .arg(installed["name"].as_str().unwrap())
        .arg(path(&installed, "icon"))
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stderr),
        fs::read_to_string(path(&installed, "desktop_file")).unwrap()
    );
    let arguments: Vec<String> = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(
        arguments,
        [
            "webapp",
            "launch",
            installed["url"].as_str().unwrap(),
            "--profile",
            profile.to_str().unwrap()
        ]
    );
    assert_eq!(
        fs::read(profile.join("Preferences")).unwrap(),
        b"{\"profile\":{\"name\":\"Other\"}}\n"
    );
    assert!(!fixture.default_profile().exists());
}
