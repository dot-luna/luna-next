use super::*;

fn theme() -> Value {
    json!({
        "colors": {
            "accent": "#7aa2f7",
            "background": "#1a1b26",
            "foreground": "#a9b1d6",
            "dark_background": "#13141c",
            "darker_background": "#0e0e14",
            "lighter_background": "#24283b",
            "light_foreground": "#b4bee6",
            "dark_foreground": "#565f89",
            "link": "#7aa2f7"
        },
        "fonts": {"ui": "Outfit", "mono": "Iosevka Nerd Font"}
    })
}

fn manifest(root: &Path, directory: &str) -> Value {
    serde_json::from_slice(&fs::read(root.join(directory).join("manifest.json")).unwrap()).unwrap()
}

#[test]
fn generates_native_rgb_colors_for_browser_surfaces() {
    let stage = tempfile::tempdir().unwrap();
    prepare(&theme(), stage.path()).unwrap();
    let native = manifest(stage.path(), "theme");
    assert_eq!(native["manifest_version"], 3);
    let colors = &native["theme"]["colors"];
    for (name, expected) in [
        ("frame", json!([19, 20, 28])),
        ("frame_inactive", json!([14, 14, 20])),
        ("toolbar", json!([26, 27, 38])),
        ("toolbar_button_icon", json!([169, 177, 214])),
        ("omnibox_background", json!([36, 40, 59])),
        ("omnibox_text", json!([169, 177, 214])),
        ("ntp_background", json!([26, 27, 38])),
        ("ntp_link", json!([122, 162, 247])),
    ] {
        assert_eq!(colors[name], expected, "{name}");
    }
    assert!(native["content_scripts"].is_null());
    assert!(native["permissions"].is_null());
    assert!(native["background"].is_null());
}

#[test]
fn website_extension_scopes_css_to_web_documents_without_scripts_or_site_colors() {
    let stage = tempfile::tempdir().unwrap();
    prepare(&theme(), stage.path()).unwrap();
    let websites = manifest(stage.path(), "websites");
    assert_eq!(websites["manifest_version"], 3);
    assert_eq!(
        websites["content_scripts"],
        json!([{
            "matches": ["http://*/*", "https://*/*"],
            "css": ["style.css"],
            "all_frames": true,
            "run_at": "document_start"
        }])
    );
    assert!(websites["background"].is_null());
    assert!(websites["permissions"].is_null());
    assert_eq!(
        fs::read_dir(stage.path().join("websites")).unwrap().count(),
        2
    );
    let css = fs::read_to_string(stage.path().join("websites/style.css")).unwrap();
    assert!(css.starts_with("*, *::before, *::after { border-radius: 0 !important; }"));
    assert!(css.contains("body, button, input, optgroup, option, select, textarea {"));
    assert!(css.contains("font-family: \"Outfit\", sans-serif !important;"));
    assert!(css.contains("pre, code, kbd, samp, pre *, code *, kbd *, samp * {"));
    assert!(css.contains("font-family: \"Iosevka Nerd Font\", monospace !important;"));
    assert!(!css.contains("background"));
    assert!(!css.contains("color:"));
    assert!(!css.contains("* {\nfont-family:"));
}

#[test]
fn quoted_font_families_cannot_end_the_css_string() {
    let stage = tempfile::tempdir().unwrap();
    let mut value = theme();
    value["fonts"]["ui"] = json!(r#"A "; } body { color: red; } /* \End"#);
    value["fonts"]["mono"] = json!("Fira 'Mono' नेपाली");
    prepare(&value, stage.path()).unwrap();
    let css = fs::read_to_string(stage.path().join("websites/style.css")).unwrap();
    assert!(css.contains(
        r#"font-family: "A \"; } body { color: red; } /* \\End", sans-serif !important;"#
    ));
    assert!(css.contains("font-family: \"Fira 'Mono' नेपाली\", monospace !important;"));
    assert_eq!(css_string("Line\nA\rB\u{c}C\0"), "\"Line\\a A\\d B\\c C�\"");
}

#[test]
fn versions_are_stable_and_follow_only_the_generated_extension_content() {
    let stage = tempfile::tempdir().unwrap();
    let value = theme();
    prepare(&value, stage.path()).unwrap();
    let native = manifest(stage.path(), "theme");
    let websites = manifest(stage.path(), "websites");
    for manifest in [&native, &websites] {
        let version = manifest["version"].as_str().unwrap();
        let components: Vec<u16> = version
            .split('.')
            .map(|part| part.parse().unwrap())
            .collect();
        assert_eq!(components.len(), 4);
        assert!(components.iter().any(|part| *part != 0));
    }
    prepare(&value, stage.path()).unwrap();
    assert_eq!(manifest(stage.path(), "theme"), native);
    assert_eq!(manifest(stage.path(), "websites"), websites);

    let mut fonts = value.clone();
    fonts["fonts"]["ui"] = json!("Changed UI Font");
    prepare(&fonts, stage.path()).unwrap();
    assert_eq!(
        manifest(stage.path(), "theme")["version"],
        native["version"]
    );
    assert_ne!(
        manifest(stage.path(), "websites")["version"],
        websites["version"]
    );

    let mut palette = value.clone();
    palette["colors"]["dark_background"] = json!("#ffffff");
    prepare(&palette, stage.path()).unwrap();
    assert_ne!(
        manifest(stage.path(), "theme")["version"],
        native["version"]
    );
    assert_eq!(
        manifest(stage.path(), "websites")["version"],
        websites["version"]
    );
}
