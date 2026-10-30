use std::{
    fs,
    os::unix::fs::{PermissionsExt, symlink},
    path::{Path, PathBuf},
    process::Command,
};

use luna_next::login::{DeploymentPaths, deploy};
use serde_json::json;

struct Fixture {
    temporary: tempfile::TempDir,
    bundle: PathBuf,
    paths: DeploymentPaths,
}

impl Fixture {
    fn new() -> Self {
        let temporary = tempfile::tempdir().unwrap();
        let bundle = temporary.path().join("bundle");
        write(bundle.join("Main.qml"), "import QtQuick\nItem {}\n");
        write(
            bundle.join("screen/Screen.qml"),
            "import QtQuick\nItem {}\n",
        );
        write(
            bundle.join("metadata.desktop"),
            "[SddmGreeterTheme]\nMainScript=Main.qml\nQtVersion=6\nTheme-API=2.0\n",
        );
        write(bundle.join("assets/background.mp4"), "video bytes");
        let settings = json!({
            "wallpaper": {"type": "video", "source": "assets/background.mp4"},
            "colors": {"background": "#112233"},
            "fonts": {"ui": "Example Sans"}
        });
        write_settings(&bundle, &settings);
        let paths = DeploymentPaths {
            theme_dir: temporary.path().join("system/themes/active"),
            sddm_config_file: temporary
                .path()
                .join("system/sddm.conf.d/90-luna-next.conf"),
        };
        Self {
            temporary,
            bundle,
            paths,
        }
    }

    fn root(&self) -> &Path {
        self.temporary.path()
    }

    fn deploy(&self) -> luna_next::Result<PathBuf> {
        deploy(&self.bundle, &self.paths)
    }

    fn assert_unpublished(&self) {
        assert!(!self.paths.theme_dir.exists());
        assert!(!self.paths.sddm_config_file.exists());
    }
}

fn write(path: impl AsRef<Path>, contents: &str) {
    let path = path.as_ref();
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, contents).unwrap();
}

fn write_settings(bundle: &Path, value: &serde_json::Value) {
    write(
        bundle.join("Settings.js"),
        &format!(".pragma library\nvar values = {value};\n"),
    );
}

fn assert_modes(path: &Path) {
    let metadata = fs::metadata(path).unwrap();
    assert_eq!(
        metadata.permissions().mode() & 0o7777,
        if metadata.is_dir() { 0o755 } else { 0o644 },
        "{}",
        path.display()
    );
    if metadata.is_dir() {
        for entry in fs::read_dir(path).unwrap() {
            assert_modes(&entry.unwrap().path());
        }
    }
}

#[test]
fn deploys_a_self_contained_theme_and_native_sddm_dropin() {
    let fixture = Fixture::new();
    fs::set_permissions(
        fixture.bundle.join("Main.qml"),
        fs::Permissions::from_mode(0o700),
    )
    .unwrap();
    fs::set_permissions(
        fixture.bundle.join("assets/background.mp4"),
        fs::Permissions::from_mode(0o600),
    )
    .unwrap();
    write(
        fixture.root().join("system/sddm.conf.d/10-other.conf"),
        "[General]\nHaltCommand=example\n",
    );
    assert_eq!(fixture.deploy().unwrap(), fixture.paths.theme_dir);
    assert_eq!(
        fs::read_to_string(&fixture.paths.sddm_config_file).unwrap(),
        format!(
            "[Theme]\nThemeDir={}\nCurrent=active\n",
            fixture.paths.theme_dir.parent().unwrap().display()
        )
    );
    assert_eq!(
        fs::read(fixture.paths.theme_dir.join("assets/background.mp4")).unwrap(),
        b"video bytes"
    );
    assert_eq!(
        fs::read_to_string(fixture.root().join("system/sddm.conf.d/10-other.conf")).unwrap(),
        "[General]\nHaltCommand=example\n"
    );
    assert_modes(&fixture.paths.theme_dir);
    assert_modes(&fixture.paths.sddm_config_file);
    fs::remove_dir_all(&fixture.bundle).unwrap();
    assert!(fixture.paths.theme_dir.join("screen/Screen.qml").is_file());
    assert!(
        fixture
            .paths
            .theme_dir
            .join("assets/background.mp4")
            .is_file()
    );
}

#[test]
fn replaces_the_whole_export_without_backups_or_executing_theme_code() {
    let fixture = Fixture::new();
    fixture.deploy().unwrap();
    write(fixture.paths.theme_dir.join("obsolete.conf"), "stale");
    let external = fixture.root().join("external");
    write(external.join("keep"), "outside");
    symlink(&external, fixture.paths.theme_dir.join("old-link")).unwrap();
    write(
        fixture.bundle.join("Main.qml"),
        "this is never executed as root\n",
    );
    fixture.deploy().unwrap();
    assert!(!fixture.paths.theme_dir.join("obsolete.conf").exists());
    assert!(!fixture.paths.theme_dir.join("old-link").exists());
    assert_eq!(
        fs::read_to_string(external.join("keep")).unwrap(),
        "outside"
    );
    assert_eq!(
        fs::read_to_string(fixture.paths.theme_dir.join("Main.qml")).unwrap(),
        "this is never executed as root\n"
    );
    assert_eq!(
        fs::read_dir(fixture.paths.theme_dir.parent().unwrap())
            .unwrap()
            .count(),
        1
    );
}

#[test]
fn rejects_missing_required_files_and_invalid_metadata_before_publication() {
    for required in [
        "Main.qml",
        "metadata.desktop",
        "Settings.js",
        "screen/Screen.qml",
    ] {
        let fixture = Fixture::new();
        fs::remove_file(fixture.bundle.join(required)).unwrap();
        assert!(fixture.deploy().is_err(), "{required}");
        fixture.assert_unpublished();
    }
    for metadata in [
        "[SddmGreeterTheme]\nMainScript=other.qml\nQtVersion=6\nTheme-API=2.0\n",
        "[SddmGreeterTheme]\nMainScript=Main.qml\nQtVersion=5\nTheme-API=2.0\n",
        "[OtherGroup]\nMainScript=Main.qml\nQtVersion=6\nTheme-API=2.0\n",
        "[SddmGreeterTheme]\nMainScript=Main.qml\nMainScript=../other.qml\nQtVersion=6\nTheme-API=2.0\n",
    ] {
        let fixture = Fixture::new();
        write(fixture.bundle.join("metadata.desktop"), metadata);
        assert!(fixture.deploy().is_err(), "{metadata}");
        fixture.assert_unpublished();
    }
}

#[test]
fn rejects_invalid_settings_escaped_assets_and_session_references() {
    for settings in [
        json!([]),
        json!({"wallpaper":{"source":"../outside"}}),
        json!({"wallpaper":{"source":"/etc/passwd"}}),
        json!({"wallpaper":{"source":"file:///etc/passwd"}}),
        json!({"wallpaper":{"source":"https://example.com/background.png"}}),
        json!({"wallpaper":{"source": "missing.png"}}),
        json!({"wallpaper":{"source": "assets/background.mp4#fragment"}}),
        json!({"wallpaper":{"source": "assets/%2e%2e/background.mp4"}}),
        json!({"wallpaper":{"source": 42}}),
        json!({"other":{"source":"/run/user/1000/luna/background"}}),
        json!({"other":"$HOME/.config/luna-next"}),
    ] {
        let fixture = Fixture::new();
        write(fixture.root().join("outside"), "outside");
        write(
            fixture.bundle.join("assets/background.mp4#fragment"),
            "fragment filename",
        );
        write(
            fixture.bundle.join("assets/%2e%2e/background.mp4"),
            "encoded filename",
        );
        write_settings(&fixture.bundle, &settings);
        assert!(fixture.deploy().is_err(), "{settings}");
        fixture.assert_unpublished();
    }
    let fixture = Fixture::new();
    write(
        fixture.bundle.join("Settings.js"),
        ".pragma library\nvar values = {}; malicious();\n",
    );
    assert!(fixture.deploy().is_err());
    fixture.assert_unpublished();
}

#[test]
fn rejects_source_links_and_special_files_without_following_them() {
    for directory_link in [false, true] {
        let fixture = Fixture::new();
        let external = fixture.root().join("outside");
        if directory_link {
            fs::create_dir(&external).unwrap();
        } else {
            write(&external, "outside");
        }
        symlink(&external, fixture.bundle.join("link")).unwrap();
        assert!(fixture.deploy().is_err());
        fixture.assert_unpublished();
    }
    let fixture = Fixture::new();
    let root_link = fixture.root().join("bundle-link");
    symlink(&fixture.bundle, &root_link).unwrap();
    assert!(deploy(&root_link, &fixture.paths).is_err());
    fixture.assert_unpublished();

    let fixture = Fixture::new();
    let _socket = std::os::unix::net::UnixListener::bind(fixture.bundle.join("socket")).unwrap();
    assert!(fixture.deploy().is_err());
    fixture.assert_unpublished();
}

#[test]
fn rejects_symlinked_destinations_and_parents_without_touching_their_targets() {
    for link_parent in [false, true] {
        let fixture = Fixture::new();
        let external = fixture.root().join("external");
        write(external.join("keep"), "outside");
        if link_parent {
            fs::create_dir_all(fixture.root().join("system")).unwrap();
            symlink(&external, fixture.paths.theme_dir.parent().unwrap()).unwrap();
        } else {
            fs::create_dir_all(fixture.paths.theme_dir.parent().unwrap()).unwrap();
            symlink(&external, &fixture.paths.theme_dir).unwrap();
        }
        assert!(fixture.deploy().is_err());
        assert_eq!(
            fs::read_to_string(external.join("keep")).unwrap(),
            "outside"
        );
        assert!(!fixture.paths.sddm_config_file.exists());
    }
    let fixture = Fixture::new();
    let external = fixture.root().join("external.conf");
    write(&external, "outside");
    fs::create_dir_all(fixture.paths.sddm_config_file.parent().unwrap()).unwrap();
    symlink(&external, &fixture.paths.sddm_config_file).unwrap();
    assert!(fixture.deploy().is_err());
    assert_eq!(fs::read_to_string(external).unwrap(), "outside");
    assert!(!fixture.paths.theme_dir.exists());
}

#[test]
fn rejects_overlapping_exports_source_destinations_and_ini_injection() {
    let mut fixture = Fixture::new();
    fixture.paths.theme_dir = fixture.bundle.join("active");
    assert!(fixture.deploy().is_err());
    assert!(fixture.bundle.join("Main.qml").exists());
    let mut fixture = Fixture::new();
    fixture.paths.sddm_config_file = fixture.paths.theme_dir.join("sddm.conf");
    assert!(fixture.deploy().is_err());
    fixture.assert_unpublished();
    let mut fixture = Fixture::new();
    fixture.paths.theme_dir = fixture.root().join("themes/active\n[General]");
    assert!(fixture.deploy().is_err());
    fixture.assert_unpublished();
    let mut fixture = Fixture::new();
    fixture.paths.theme_dir = fixture.root().join("themes/../active");
    assert!(fixture.deploy().is_err());
    fixture.assert_unpublished();
}

#[test]
fn restrictive_umask_does_not_make_deployed_assets_private() {
    let output = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "deployment_under_restrictive_umask",
            "--nocapture",
        ])
        .env("LUNA_LOGIN_UMASK_TEST", "1")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn deployment_under_restrictive_umask() {
    if std::env::var_os("LUNA_LOGIN_UMASK_TEST").is_none() {
        return;
    }
    // The mask is process-global, so this scenario runs alone in its own child.
    unsafe {
        libc::umask(0o077);
    }
    let fixture = Fixture::new();
    fixture.deploy().unwrap();
    assert_modes(&fixture.paths.theme_dir);
    assert_modes(&fixture.paths.sddm_config_file);
}
