use std::{fs, path::Path};

use luna_next::install::{Package, Source, find_repository, get_packages};
use tempfile::TempDir;

fn fixture() -> TempDir {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join("installs")).unwrap();
    fs::create_dir(root.path().join("renderer")).unwrap();
    write(
        root.path(),
        "packages.conf",
        r#"
        core = [{ name: git, source: pacman }]
        main = [
            { name: kitty, source: pacman },
            { name: mpvpaper, source: aur }
        ]
        "#,
    );
    write(
        root.path(),
        "packages.git.conf",
        r#"[{ name: yay, source: git, url: "https://example.com/yay.git",
              command: [[makepkg, "--install"]] }]"#,
    );
    write(
        root.path(),
        "packages.mise.conf",
        "[{ name: rust, source: mise, version: stable }]",
    );
    write(
        root.path(),
        "packages.local.conf",
        r#"[{ name: wallpaper, source: local, url: renderer,
              destination: "share/luna-next/wallpaper" }]"#,
    );
    root
}

fn write(root: &Path, manifest: &str, source: &str) {
    fs::write(root.join("installs").join(manifest), source).unwrap();
}

fn select(
    root: &Path,
    groups: &[&str],
    source: Option<Source>,
    names: &[&str],
) -> luna_next::Result<Vec<Package>> {
    let names: Vec<_> = names.iter().map(|name| (*name).to_owned()).collect();
    get_packages(root, groups, source, &names)
}

fn names(packages: &[Package]) -> Vec<&str> {
    let mut names: Vec<_> = packages
        .iter()
        .map(|package| package.name.as_str())
        .collect();
    names.sort_unstable();
    names
}

#[test]
fn repository_manifests_load_with_current_local_sources() {
    let repository = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    let packages = select(&repository, &[], None, &[]).unwrap();
    assert!(packages.iter().any(|package| package.name == "git"));
    assert!(packages.iter().any(|package| package.name == "yay"));
    assert!(packages.iter().any(|package| package.name == "rust"));
    let t3code = packages
        .iter()
        .find(|package| package.name == "t3code")
        .unwrap();
    assert_eq!(t3code.source, Source::Git);
    assert_eq!(t3code.version.as_deref(), Some("latest"));
    assert!(t3code.git_include_prereleases);
    assert_eq!(t3code.git_release_tag_pattern.as_deref(), Some("v[0-9]*"));

    for (name, source) in [
        ("hocon-qml", "packages/hocon-qml"),
        ("wallpaper", "src/luna-wallpaper/src"),
        ("cli", "src/ln-cli"),
    ] {
        let package = packages
            .iter()
            .find(|package| package.name == name)
            .unwrap();
        assert_eq!(package.source, Source::Local);
        assert_eq!(
            Path::new(package.url.as_deref().unwrap()),
            repository.join(source)
        );
    }
    let local = luna_next_hocon::load(repository.join("installs/packages.local.conf")).unwrap();
    assert!(
        local
            .as_array()
            .unwrap()
            .iter()
            .all(|package| package.get("kind").is_none())
    );
}

#[test]
fn default_selection_loads_all_catalogs_without_installing() {
    let root = fixture();
    let packages = select(root.path(), &[], None, &[]).unwrap();
    assert_eq!(
        names(&packages),
        ["git", "kitty", "mpvpaper", "rust", "wallpaper", "yay"]
    );
    let wallpaper = packages
        .iter()
        .find(|package| package.name == "wallpaper")
        .unwrap();
    assert!(wallpaper.command.is_empty());
    assert_eq!(
        wallpaper.destination.as_deref(),
        Some(Path::new("share/luna-next/wallpaper"))
    );
    assert!(!root.path().join(".local").exists());
}

#[test]
fn groups_and_sources_filter_the_catalog() {
    let root = fixture();
    let main = select(root.path(), &["main"], None, &[]).unwrap();
    assert_eq!(names(&main), ["kitty", "mpvpaper"]);
    let pacman = select(root.path(), &["core", "main"], Some(Source::Pacman), &[]).unwrap();
    assert_eq!(names(&pacman), ["git", "kitty"]);

    for (source, name) in [
        (Source::Aur, "mpvpaper"),
        (Source::Git, "yay"),
        (Source::Mise, "rust"),
        (Source::Local, "wallpaper"),
    ] {
        let packages = select(root.path(), &[], Some(source), &[]).unwrap();
        assert_eq!(names(&packages), [name]);
        assert!(packages.iter().all(|package| package.source == source));
    }
}

#[test]
fn names_lookup_across_manifests_preserves_order_and_respects_filters() {
    let root = fixture();
    let packages = select(
        root.path(),
        &[],
        None,
        &["yay", "kitty", "rust", "wallpaper", "kitty"],
    )
    .unwrap();
    let selected: Vec<_> = packages
        .iter()
        .map(|package| package.name.as_str())
        .collect();
    assert_eq!(selected, ["yay", "kitty", "rust", "wallpaper"]);
    let packages = select(root.path(), &["main"], None, &["kitty"]).unwrap();
    assert_eq!(names(&packages), ["kitty"]);
    assert!(select(root.path(), &["main"], None, &["git"]).is_err());
    assert!(select(root.path(), &[], Some(Source::Mise), &["yay"]).is_err());
}

#[test]
fn explicit_system_sources_allow_unlisted_names_without_a_group() {
    let root = fixture();
    for source in [Source::Pacman, Source::Aur] {
        let packages = select(root.path(), &[], Some(source), &["unlisted"]).unwrap();
        assert_eq!(packages.len(), 1);
        assert_eq!(packages[0].name, "unlisted");
        assert_eq!(packages[0].source, source);
        assert!(packages[0].url.is_none());
        assert!(packages[0].version.is_none());
        assert!(packages[0].command.is_empty());
        assert!(select(root.path(), &["main"], Some(source), &["unlisted"]).is_err());
    }
    for source in [Source::Git, Source::Mise, Source::Local] {
        assert!(select(root.path(), &[], Some(source), &["unlisted"]).is_err());
    }
    assert!(select(root.path(), &[], None, &["unlisted"]).is_err());
    assert!(select(root.path(), &["unknown"], None, &[]).is_err());
}

#[test]
fn malformed_fields_unknown_groups_and_duplicate_catalog_entries_fail() {
    for source in [
        "core = [",
        "extra = []",
        "core = {}",
        "core = [{ name: git }]",
        "core = [{ name: git, source: unknown }]",
        "core = [{ name: 42, source: pacman }]",
        "core = [{ name: git, source: pacman, command: invalid }]",
        "core = [{ name: git, source: pacman }]\nmain = [{ name: git, source: pacman }]",
    ] {
        let root = fixture();
        write(root.path(), "packages.conf", source);
        assert!(
            select(root.path(), &[], None, &[]).is_err(),
            "accepted {source}"
        );
    }
    for manifest in [
        "packages.git.conf",
        "packages.mise.conf",
        "packages.local.conf",
    ] {
        let root = fixture();
        write(root.path(), manifest, "[{ name: wrong, source: pacman }]");
        assert!(
            select(root.path(), &[], None, &[]).is_err(),
            "accepted mismatched source in {manifest}"
        );
    }
    let root = fixture();
    write(
        root.path(),
        "packages.git.conf",
        "[{ name: git, source: git, url: repository, command: [[build]] }]",
    );
    assert!(select(root.path(), &[], None, &[]).is_ok());
}

#[test]
fn missing_manifests_are_reported_without_creating_them() {
    for manifest in [
        "packages.conf",
        "packages.git.conf",
        "packages.mise.conf",
        "packages.local.conf",
    ] {
        let root = fixture();
        let path = root.path().join("installs").join(manifest);
        fs::remove_file(&path).unwrap();
        assert!(select(root.path(), &[], None, &[]).is_err());
        assert!(!path.exists());
    }
}

#[test]
fn includes_comments_and_relative_local_urls_are_resolved_without_edits() {
    let root = fixture();
    let source = "# Package groups\ninclude file(\"core.conf\")\nmain = []\n";
    write(root.path(), "packages.conf", source);
    write(
        root.path(),
        "core.conf",
        "core = [{ name: git, source: pacman }]\n",
    );
    let local = "# Local source is relative to the checkout, not this list.\n[{ name: wallpaper, source: local, url: renderer }]\n";
    write(root.path(), "packages.local.conf", local);
    let packages = select(root.path(), &[], None, &["git", "wallpaper"]).unwrap();
    let wallpaper = packages
        .iter()
        .find(|package| package.name == "wallpaper")
        .unwrap();
    assert_eq!(
        Path::new(wallpaper.url.as_deref().unwrap()),
        root.path().join("renderer")
    );
    assert_eq!(
        fs::read_to_string(root.path().join("installs/packages.conf")).unwrap(),
        source
    );
    assert_eq!(
        fs::read_to_string(root.path().join("installs/packages.local.conf")).unwrap(),
        local
    );
}

#[test]
fn explicit_repository_paths_are_resolved_without_creating_missing_paths() {
    let root = fixture();
    assert_eq!(
        find_repository(Some(root.path())).unwrap(),
        root.path().canonicalize().unwrap()
    );
    let missing = root.path().join("missing");
    assert!(find_repository(Some(&missing)).is_err());
    assert!(!missing.exists());
}
