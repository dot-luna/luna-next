use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::Command,
};

use luna_next::install::{Webapp, get_webapps, install_webapps};
use serde_json::{Value, json};
use tempfile::TempDir;

fn catalog(source: &str) -> TempDir {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join("installs")).unwrap();
    fs::write(root.path().join("installs/packages.webapp.conf"), source).unwrap();
    root
}

#[test]
fn repository_catalog_selects_youtube() {
    let recipes = get_webapps(&Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap();
    assert_eq!(recipes.len(), 1);
    assert_eq!(recipes[0].name, "YouTube");
    assert_eq!(recipes[0].url, "https://www.youtube.com/");
    assert!(recipes[0].icon_url.is_none());
}

#[test]
fn includes_resolve_without_rewriting_catalog_sources() {
    let source = "# Keep recipe defaults separate.\n[{ include required(file(\"youtube.conf\"))\nname: YouTube }]\n";
    let root = catalog(source);
    let included =
        "url: \"https://www.youtube.com/\"\nicon_url: \"https://example.com/icon.png\"\n";
    let include_path = root.path().join("installs/youtube.conf");
    fs::write(&include_path, included).unwrap();
    let recipes = get_webapps(root.path()).unwrap();
    assert_eq!(recipes.len(), 1);
    assert_eq!(recipes[0].name, "YouTube");
    assert_eq!(recipes[0].url, "https://www.youtube.com/");
    assert_eq!(
        recipes[0].icon_url.as_deref(),
        Some("https://example.com/icon.png")
    );
    assert_eq!(
        fs::read_to_string(root.path().join("installs/packages.webapp.conf")).unwrap(),
        source
    );
    assert_eq!(fs::read_to_string(include_path).unwrap(), included);
}

#[test]
fn missing_manifest_is_an_error_without_creation() {
    let root = tempfile::tempdir().unwrap();
    let error = get_webapps(root.path()).unwrap_err();
    assert!(
        error.to_string().contains("packages.webapp.conf"),
        "{error}"
    );
    assert!(!root.path().join("installs").exists());
}

#[test]
fn rejects_malformed_fields_invalid_urls_and_colliding_trimmed_names() {
    for source in [
        "[",
        "webapps = []",
        "[{name: YouTube}]",
        "[{name: 3, url: \"https://example.com/\"}]",
        "[{name: YouTube, url: \"https://example.com/\", icon_url: 3}]",
        "[{name: YouTube, url: \"https://example.com/\", profile: Other}]",
        "[{name: \"\", url: \"https://example.com/\"}]",
        "[{name: \"bad\\nname\", url: \"https://example.com/\"}]",
        "[{name: YouTube, url: \"file:///tmp/site\"}]",
        "[{name: YouTube, url: \"https://user:pass@example.com/\"}]",
        "[{name: YouTube, url: \"https://example.com/%0a\"}]",
        "[{name: YouTube, url: \"https://example.com/\", icon_url: \"file:///tmp/icon\"}]",
        "[{name: YouTube, url: \"https://example.com/\", icon_url: \"https://user:pass@example.com/icon\"}]",
        "[{name: YouTube, url: \"https://example.com/\"}, {name: YouTube, url: \"https://other.example/\"}]",
        "[{name: YouTube, url: \"https://example.com/\"}, {name: \" YouTube \", url: \"https://other.example/\"}]",
        "[{include required(file(\"missing.conf\"))}]",
    ] {
        let root = catalog(source);
        assert!(get_webapps(root.path()).is_err(), "accepted {source}");
        assert_eq!(
            fs::read_to_string(root.path().join("installs/packages.webapp.conf")).unwrap(),
            source
        );
    }
    let source = format!(
        "[{{name: \"{}\", url: \"https://example.com/\"}}]",
        "x".repeat(101)
    );
    assert!(get_webapps(catalog(&source).path()).is_err());
}

#[test]
fn empty_catalog_does_not_require_browser_or_launcher_paths() {
    let root = catalog("[]");
    let recipes = get_webapps(root.path()).unwrap();
    let missing = root.path().join("missing/luna");
    let report = install_webapps(&recipes, &missing).unwrap();
    assert!(report.installed.is_empty());
    assert!(report.skipped.is_empty());
    assert!(!missing.parent().unwrap().exists());
}

struct Fixture {
    root: TempDir,
}

impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let bin = root.path().join("bin");
        fs::create_dir(&bin).unwrap();
        for (name, body) in [
            ("luna", "exit 89\n"),
            (
                "pacman",
                "printf '%s\\n' 'ungoogled-chromium-bin 156.0.8078.73-1'\n",
            ),
            (
                "chromium",
                "[ \"$*\" = --version ] || exit 78\nprintf '%s\\n' 'Chromium 156.0.8078.73'\n",
            ),
            ("file", "exec /usr/bin/file \"$@\"\n"),
            (
                "curl",
                r#"printf '%s\n' "$@" >> "$LUNA_CATALOG_FIXTURE/downloads"
[ ! -e "$LUNA_CATALOG_FIXTURE/fail-download" ] || exit 22
while [ "$#" -gt 0 ]; do
    case "$1" in
        --output) shift; destination=$1;;
        --url) shift; url=$1;;
    esac
    shift
done
case "$url" in
    */icon.png) /usr/bin/cp "$LUNA_CATALOG_FIXTURE/icon.png" "$destination";;
    *) printf '%s' '<html><head><link rel="icon" href="/icon.png"></head></html>' > "$destination";;
esac
printf '%s' "$url"
"#,
            ),
        ] {
            let path = bin.join(name);
            fs::write(&path, format!("#!/bin/sh\n{body}")).unwrap();
            fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
        }
        let png = [
            137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
            8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 11, 73, 68, 65, 84, 120, 156, 99, 96, 0, 2,
            0, 0, 5, 0, 1, 165, 246, 69, 64, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
        ];
        fs::write(root.path().join("icon.png"), png).unwrap();
        Self { root }
    }

    fn profile(&self) -> PathBuf {
        self.root.path().join("config/luna-next/chromium/Default")
    }

    fn create_profile(&self) {
        let profile = self.profile();
        fs::create_dir_all(&profile).unwrap();
        fs::write(profile.join("Preferences"), b"{\"keep\":true}\n").unwrap();
        fs::write(profile.parent().unwrap().join("Local State"), b"{}\n").unwrap();
        fs::write(
            profile.parent().unwrap().join(".luna-managed"),
            b"Luna Next Chromium\n",
        )
        .unwrap();
    }

    fn install(&self, recipes: Value) -> Result<Value, String> {
        let output = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "install_catalog_in_child", "--nocapture"])
            .env_clear()
            .env("HOME", self.root.path().join("home"))
            .env("PATH", self.root.path().join("bin"))
            .env("XDG_CONFIG_HOME", self.root.path().join("config"))
            .env("XDG_DATA_HOME", self.root.path().join("data"))
            .env("LUNA_CATALOG_FIXTURE", self.root.path())
            .env("LUNA_CATALOG_RECIPES", recipes.to_string())
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
        assert!(output.stderr.is_empty(), "{output:?}");
        let stdout = String::from_utf8(output.stdout).unwrap();
        for line in stdout.lines() {
            if let Some(value) = line.strip_prefix("CATALOG_OK: ") {
                return Ok(serde_json::from_str(value).unwrap());
            }
            if let Some(error) = line.strip_prefix("CATALOG_ERROR: ") {
                return Err(error.to_owned());
            }
        }
        panic!("missing result: {stdout}")
    }

    fn entries(&self) -> Vec<PathBuf> {
        fs::read_dir(self.root.path().join("data/applications"))
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| {
                path.extension()
                    .is_some_and(|extension| extension == "desktop")
            })
            .collect()
    }
}

fn youtube() -> Value {
    json!({"name": "YouTube", "url": "https://www.youtube.com/"})
}

#[test]
fn install_catalog_in_child() {
    let Some(root) = std::env::var_os("LUNA_CATALOG_FIXTURE") else {
        return;
    };
    let recipes: Vec<Webapp> =
        serde_json::from_str(&std::env::var("LUNA_CATALOG_RECIPES").unwrap()).unwrap();
    match install_webapps(&recipes, &PathBuf::from(root).join("bin/luna")) {
        Ok(report) => println!("CATALOG_OK: {}", serde_json::to_string(&report).unwrap()),
        Err(error) => println!("CATALOG_ERROR: {error}"),
    }
}

#[test]
fn installs_default_profile_desktop_entry_and_reports_trimmed_name() {
    let fixture = Fixture::new();
    fixture.create_profile();
    let preferences = fs::read(fixture.profile().join("Preferences")).unwrap();
    let report = fixture
        .install(json!([{"name": " YouTube ", "url": "https://www.youtube.com/"}]))
        .unwrap();
    assert_eq!(report["installed"], json!(["YouTube"]));
    assert_eq!(report["skipped"], json!([]));
    let entries = fixture.entries();
    assert_eq!(entries.len(), 1);
    let entry = fs::read_to_string(&entries[0]).unwrap();
    assert!(entry.contains("Name=YouTube\n"));
    assert!(entry.contains("webapp launch"));
    assert!(entry.contains("https://www.youtube.com/"));
    assert!(!entry.contains("--profile"));
    assert_eq!(
        fs::read(fixture.profile().join("Preferences")).unwrap(),
        preferences
    );
}

#[test]
fn public_installer_validates_whole_batch_before_any_download_or_replacement() {
    let fixture = Fixture::new();
    fixture.create_profile();
    fixture.install(json!([youtube()])).unwrap();
    let entry = fixture.entries().remove(0);
    let original = fs::read(&entry).unwrap();
    let downloads = fixture.root.path().join("downloads");
    fs::remove_file(&downloads).unwrap();
    for invalid in [
        json!({"name": "Other", "url": "file:///tmp/site"}),
        json!({"name": "Other", "url": "https://example.com/", "icon_url": "file:///tmp/icon"}),
        json!({"name": " Other\nname", "url": "https://example.com/"}),
        json!({"name": " YouTube ", "url": "https://other.example/"}),
    ] {
        assert!(fixture.install(json!([youtube(), invalid])).is_err());
        assert!(!downloads.exists());
        assert_eq!(fs::read(&entry).unwrap(), original);
        assert_eq!(fixture.entries().len(), 1);
    }
}

#[test]
fn missing_profile_and_download_failure_preserve_existing_exports() {
    let fixture = Fixture::new();
    assert!(
        fixture
            .install(json!([youtube()]))
            .unwrap_err()
            .contains("create-profile")
    );
    assert!(!fixture.root.path().join("data").exists());
    fixture.create_profile();
    fixture.install(json!([youtube()])).unwrap();
    let entry = fixture.entries().remove(0);
    let original = fs::read(&entry).unwrap();
    fs::write(fixture.root.path().join("fail-download"), b"").unwrap();
    assert!(fixture.install(json!([youtube()])).is_err());
    assert_eq!(fs::read(entry).unwrap(), original);
}
