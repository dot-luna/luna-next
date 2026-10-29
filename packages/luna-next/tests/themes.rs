use std::{
    fs,
    os::unix::fs::symlink,
    path::{Path, PathBuf},
};

use luna_next::theme::{Paths, Themes};
use serde_json::{Value, json};

struct Fixture {
    root: tempfile::TempDir,
    themes: Themes,
}

impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let themes = Themes::new(Paths {
            config_file: root.path().join("config/theme.conf"),
            library_dir: root.path().join("data/themes"),
            wallpaper_dir: root.path().join("data/wallpapers"),
        })
        .unwrap();
        Self { root, themes }
    }
    fn source(&self, name: &str, source: &str) -> PathBuf {
        let directory = self.root.path().join("sources").join(name);
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("theme.conf"), source).unwrap();
        directory
    }
    fn select(&self, name: &str) {
        fs::create_dir_all(self.themes.config_file().parent().unwrap()).unwrap();
        fs::write(
            self.themes.config_file(),
            format!("theme {{ name = \"{name}\" }}\n"),
        )
        .unwrap();
    }
}

fn bundled() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../themes/bundled/tokyo-night")
}

#[test]
fn bundled_tokyo_night_matches_complete_defaults_and_the_schema_exactly() {
    let f = Fixture::new();
    let defaults = f.themes.get(None).unwrap();
    let installed = f.themes.install(&bundled(), None, false).unwrap();
    assert_eq!(f.themes.inspect("tokyo-night").unwrap(), defaults);
    assert_eq!(
        fs::read(installed.join("theme.conf")).unwrap(),
        fs::read(bundled().join("theme.conf")).unwrap()
    );
    assert_eq!(f.themes.current().unwrap(), None);
    assert_eq!(fs::read_to_string(f.themes.config_file()).unwrap(), "");
    let schema: Value =
        serde_json::from_str(include_str!("../../../themes/theme.schema.json")).unwrap();
    fn check_fields(value: &Value, schema: &Value) {
        if let Some(fields) = value.as_object() {
            let expected = schema["properties"].as_object().unwrap();
            assert_eq!(
                fields.keys().collect::<Vec<_>>(),
                expected.keys().collect::<Vec<_>>()
            );
            assert_eq!(schema["additionalProperties"], false);
            for (key, value) in fields {
                check_fields(value, &expected[key]);
            }
        }
    }
    let mut defaults = defaults;
    defaults.as_object_mut().unwrap().remove("name");
    check_fields(&defaults, &schema);
}

#[test]
fn partial_themes_merge_includes_and_derive_readable_pairs_without_rewriting_sources() {
    let f = Fixture::new();
    let text = "# author comment\ninclude required(file(\"palette.conf\"))\nappearance { rounding = 12 }\n";
    let source = f.source("custom", text);
    fs::write(source.join("palette.conf"), "colors { accent = \"#ffffff\", success = \"#000000\" }\nfonts { ui = \"A Custom Font\" }\n").unwrap();
    let installed = f.themes.install(&source, None, false).unwrap();
    fs::remove_dir_all(source).unwrap();
    f.select("custom");
    let value = f.themes.get(None).unwrap();
    assert_eq!(value["colors"]["accent_foreground"], "#000000");
    assert_eq!(value["colors"]["success_foreground"], "#ffffff");
    assert_eq!(value["colors"]["success_emphasis"], "#000000");
    assert_eq!(value["fonts"]["ui"], "A Custom Font");
    assert_eq!(value["fonts"]["mono"], "Iosevka Nerd Font");
    assert_eq!(value["appearance"]["rounding"], 12);
    assert_eq!(value["appearance"]["gaps"]["inner"], 5);
    assert_eq!(f.themes.get(Some("absent.value")).unwrap(), Value::Null);
    assert!(f.themes.get(Some("colors..accent")).is_err());
    assert_eq!(
        fs::read_to_string(installed.join("theme.conf")).unwrap(),
        text
    );
    assert!(f.themes.list().unwrap()[0].current);
    let native = f.themes.hyprland().unwrap();
    assert_eq!(native["general"]["col"]["active_border"], "#ffffff");
    assert_eq!(native["decoration"]["rounding"], 12);
    assert_eq!(native["decoration"]["shadow"]["render_power"], 3);
    assert_eq!(
        native["decoration"]["shadow"]["color_inactive"],
        "#0e0e1466"
    );
}

#[test]
fn light_themes_get_light_surfaces_and_explicit_foregrounds_are_preserved() {
    let f = Fixture::new();
    let source = f.source("light", "colors { mode = light, accent = \"#ffffff\", accent_foreground = \"#123456\", link = \"#223344\" }\n");
    f.themes.install(&source, None, false).unwrap();
    let value = f.themes.inspect("light").unwrap();
    assert_eq!(value["colors"]["background"], "#e1e2e7");
    assert_eq!(value["colors"]["foreground"], "#343b58");
    assert_eq!(value["colors"]["accent_foreground"], "#123456");
    assert_eq!(value["colors"]["link_emphasis"], "#223344");
}

#[test]
fn unknown_roles_types_and_out_of_range_appearance_fail_before_replacing_an_install() {
    let f = Fixture::new();
    let source = f.source("valid", "colors { accent = \"#123456\" }\n");
    f.themes.install(&source, Some("custom"), false).unwrap();
    for invalid in [
        "colors { acccent = \"#123456\" }",
        "colors { accent = \"#1234\" }",
        "colors { mode = auto }",
        "fonts { ui = \" \" }",
        "fonts { size = 12 }",
        "appearance { rounding = -1 }",
        "appearance { opacity { active = 1.1 } }",
        "appearance { blur { passes = 11 } }",
        "appearance { shadow { falloff = 5 } }",
        "appearance { gaps { inner = 1.5 } }",
        "hyprland { decoration { rounding = 5 } }",
        "wallpaper { sources = null }",
        "[]",
    ] {
        fs::write(source.join("theme.conf"), invalid).unwrap();
        assert!(
            f.themes.install(&source, Some("custom"), true).is_err(),
            "accepted {invalid}"
        );
        assert_eq!(
            f.themes.inspect("custom").unwrap()["colors"]["accent"],
            "#123456"
        );
    }
}

#[test]
fn installation_imports_theme_relative_wallpapers_without_selecting_them() {
    let f = Fixture::new();
    let source = f.source("images", "wallpaper { sources = [\"wallpapers\"] }\n");
    fs::create_dir(source.join("wallpapers")).unwrap();
    let image = b"<svg xmlns='http://www.w3.org/2000/svg' width='2' height='2'><rect width='2' height='2' fill='red'/></svg>";
    fs::write(source.join("wallpapers/sample.svg"), image).unwrap();
    f.themes.install(&source, None, false).unwrap();
    assert_eq!(
        fs::read(f.root.path().join("data/wallpapers/sample.svg")).unwrap(),
        image
    );
    assert_eq!(f.themes.current().unwrap(), None);
    assert!(!f.root.path().join("config/wallpaper.conf").exists());
    f.themes.remove(&["images".into()]).unwrap();
    assert!(source.exists());
    assert!(f.root.path().join("data/wallpapers/sample.svg").exists());
}

#[test]
fn install_and_remove_reject_escaping_paths_links_and_overlapping_sources() {
    let f = Fixture::new();
    let source = f.source("custom", "{}\n");
    for name in ["../outside", "/tmp/theme", "", "Wrong", ".hidden"] {
        assert!(f.themes.install(&source, Some(name), true).is_err());
    }
    f.themes.install(&source, None, false).unwrap();
    assert!(f.themes.install(&source, None, false).is_err());
    let external = f.root.path().join("external");
    fs::create_dir(&external).unwrap();
    fs::write(external.join("keep"), "untouched").unwrap();
    symlink(&external, f.themes.directory().join("linked")).unwrap();
    assert!(f.themes.install(&source, Some("linked"), true).is_err());
    assert!(f.themes.remove(&["linked".into()]).is_err());
    f.select("custom");
    assert!(f.themes.remove(&["custom".into()]).is_err());
    assert!(
        f.themes
            .remove(&["custom".into(), "missing".into()])
            .is_err()
    );
    assert!(f.themes.path("custom").unwrap().exists());
    fs::write(
        source.join("theme.conf"),
        "wallpaper { sources = [\"../outside.svg\"] }\n",
    )
    .unwrap();
    fs::write(source.parent().unwrap().join("outside.svg"), "untouched").unwrap();
    assert!(f.themes.install(&source, Some("escape"), false).is_err());
    assert!(!f.themes.directory().join("escape").exists());
    fs::write(f.root.path().join("theme.conf"), "{}\n").unwrap();
    assert!(
        f.themes
            .install(f.root.path(), Some("recursive"), false)
            .is_err()
    );
    assert_eq!(
        fs::read_to_string(external.join("keep")).unwrap(),
        "untouched"
    );
}

#[test]
fn force_replaces_the_whole_export_and_batch_removal_validates_before_deletion() {
    let f = Fixture::new();
    let source = f.source("custom", "{}\n");
    let path = f.themes.install(&source, None, false).unwrap();
    fs::write(path.join("obsolete"), "old").unwrap();
    f.themes.install(&source, None, true).unwrap();
    assert!(!path.join("obsolete").exists());
    assert!(
        f.themes
            .remove(&["custom".into(), "missing".into()])
            .is_err()
    );
    assert!(path.exists());
    assert_eq!(
        f.themes
            .remove(&["custom".into(), "custom".into()])
            .unwrap(),
        vec![path]
    );
    assert!(f.themes.list().unwrap().is_empty());
}

fn luminance(value: &str) -> f64 {
    [0.2126, 0.7152, 0.0722]
        .into_iter()
        .enumerate()
        .map(|(index, weight)| {
            let i = 1 + index * 2;
            let c = u8::from_str_radix(&value[i..i + 2], 16).unwrap() as f64 / 255.0;
            weight
                * if c <= 0.04045 {
                    c / 12.92
                } else {
                    ((c + 0.055) / 1.055).powf(2.4)
                }
        })
        .sum()
}

fn contrast(a: &Value, b: &Value) -> f64 {
    let (a, b) = (
        luminance(a.as_str().unwrap()),
        luminance(b.as_str().unwrap()),
    );
    (a.max(b) + 0.05) / (a.min(b) + 0.05)
}

#[test]
fn both_default_palettes_have_readable_text_and_fill_pairs() {
    let f = Fixture::new();
    for mode in ["dark", "light"] {
        let source = f.source(mode, &format!("colors {{ mode = {mode} }}\n"));
        f.themes.install(&source, None, false).unwrap();
        let value = f.themes.inspect(mode).unwrap();
        let colors = &value["colors"];
        for role in [
            "foreground",
            "light_foreground",
            "bright_foreground",
            "comment",
            "link",
            "error",
            "warning",
            "notice",
            "success",
            "info",
        ] {
            for surface in ["background", "lighter_background"] {
                assert!(
                    contrast(&colors[role], &colors[surface]) >= 4.5,
                    "{mode}: {role} on {surface}"
                );
            }
        }
        for role in [
            "accent",
            "selection",
            "secondary_accent",
            "error",
            "warning",
            "notice",
            "success",
            "info",
        ] {
            assert!(
                contrast(&colors[role], &colors[format!("{role}_foreground")]) >= 4.5,
                "{mode}: {role} foreground"
            );
        }
        assert_eq!(value.get("hyprland"), None);
        assert_eq!(value["appearance"]["rounding"], json!(0));
    }
}
