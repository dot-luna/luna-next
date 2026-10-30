use super::*;

fn config_dir() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/zen/config")
}

fn theme() -> Value {
    luna_next_hocon::load(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../themes/bundled/tokyo-night/theme.conf"),
    )
    .unwrap()
}

fn preferences(source: &str) -> serde_json::Map<String, Value> {
    source
        .lines()
        .filter(|line| line.starts_with("user_pref("))
        .map(|line| {
            let arguments = line
                .strip_prefix("user_pref(")
                .unwrap()
                .strip_suffix(");")
                .unwrap();
            let arguments: Vec<Value> = serde_json::from_str(&format!("[{arguments}]")).unwrap();
            assert_eq!(arguments.len(), 2);
            (
                arguments[0].as_str().unwrap().to_owned(),
                arguments[1].clone(),
            )
        })
        .collect()
}

#[test]
fn ports_native_palette_and_text_fonts_without_changing_website_colors_or_fonts() {
    let rendered = render(&config_dir(), &theme()).unwrap();
    let chrome = rendered.user_chrome;
    assert!(!chrome.contains("{{"));
    assert!(chrome.contains("@-moz-document url(\"chrome://browser/content/browser.xhtml\")"));
    assert!(chrome.contains("--zen-primary-color: #7aa2f7 !important;"));
    assert!(chrome.contains("--zen-main-browser-background: #1a1b26 !important;"));
    assert!(chrome.contains("--zen-colors-primary-foreground: #a9b1d6 !important;"));
    assert!(chrome.contains("--luna-ui-font: \"Outfit\", sans-serif !important;"));
    assert!(chrome.contains(".tab-label, .toolbarbutton-text, menu, menuitem, menulist,"));
    assert!(!chrome.contains("* {\n        font-family:"));

    assert!(
        rendered
            .user_content
            .contains("url-prefix(\"http://\"), url-prefix(\"https://\")")
    );
    assert!(
        rendered
            .user_content
            .contains("border-radius: 0 !important;")
    );
    assert!(!rendered.user_content.contains("font-family"));
    assert!(!rendered.user_content.contains("color:"));
    assert!(!rendered.user_content.contains("background"));
}

#[test]
fn sets_gecko_font_defaults_and_keeps_site_fonts_signatures_and_profile_scope() {
    let rendered = render(&config_dir(), &theme()).unwrap();
    let prefs = preferences(&rendered.user_js);
    assert_eq!(prefs.len(), 6 + FONT_GROUPS.len() * 4);
    assert_eq!(FONT_GROUPS.len(), 28);
    for group in FONT_GROUPS {
        assert_eq!(prefs[&format!("font.default.{group}")], "sans-serif");
        assert_eq!(prefs[&format!("font.name.serif.{group}")], "Outfit");
        assert_eq!(prefs[&format!("font.name.sans-serif.{group}")], "Outfit");
        assert_eq!(
            prefs[&format!("font.name.monospace.{group}")],
            "Iosevka Nerd Font"
        );
    }
    assert_eq!(
        prefs["toolkit.legacyUserProfileCustomizations.stylesheets"],
        true
    );
    assert_eq!(prefs["browser.display.use_document_fonts"], 1);
    assert_eq!(prefs["extensions.autoDisableScopes"], 14);
    assert_eq!(prefs["extensions.startupScanScopes"], 1);
    assert_eq!(prefs["xpinstall.signatures.required"], true);
    assert!(
        !prefs
            .keys()
            .any(|key| key.contains("x-math") || key.starts_with("devtools."))
    );
}

#[test]
fn square_rounding_is_removed_on_a_later_rounded_theme() {
    let square = render(&config_dir(), &theme()).unwrap();
    assert!(
        square
            .user_chrome
            .contains("--zen-border-radius: 0px !important;")
    );
    assert!(square.user_chrome.contains("border-radius: 0 !important;"));
    assert_eq!(preferences(&square.user_js)["zen.theme.border-radius"], 0);

    let mut rounded_theme = theme();
    rounded_theme["appearance"]["rounding"] = json!(12);
    let rounded = render(&config_dir(), &rounded_theme).unwrap();
    assert!(!rounded.user_chrome.contains("border-radius:"));
    assert!(!rounded.user_content.contains("border-radius:"));
    assert_eq!(preferences(&rounded.user_js)["zen.theme.border-radius"], -1);
}

#[test]
fn font_names_stay_literal_in_preferences_and_css_including_template_delimiters() {
    let mut value = theme();
    let ui = "A \"; } body { color: red; } /* \\End {{colors.accent}}";
    let mono = "Fira 'Mono' नेपाली";
    value["fonts"]["ui"] = json!(ui);
    value["fonts"]["mono"] = json!(mono);
    let rendered = render(&config_dir(), &value).unwrap();
    assert!(rendered.user_chrome.contains(
        r#"--luna-ui-font: "A \"; } body { color: red; } /* \\End {{colors.accent}}", sans-serif !important;"#
    ));
    let prefs = preferences(&rendered.user_js);
    assert_eq!(prefs["font.name.sans-serif.x-western"], ui);
    assert_eq!(prefs["font.name.monospace.x-western"], mono);

    value["fonts"]["ui"] = json!("Line\nA\rB\u{c}C\0");
    let rendered = render(&config_dir(), &value).unwrap();
    assert!(rendered.user_chrome.contains("\"Line\\a A\\d B\\c C�\""));
    assert_eq!(
        preferences(&rendered.user_js)["font.name.sans-serif.x-western"],
        "Line\nA\rB\u{c}C\0"
    );
}

#[test]
fn errors_in_templates_or_required_theme_values_are_reported() {
    let mut value = theme();
    value["fonts"]["ui"] = Value::Null;
    assert!(
        render(&config_dir(), &value)
            .err()
            .unwrap()
            .to_string()
            .contains("fonts.ui")
    );

    let directory = tempfile::tempdir().unwrap();
    for name in ["square-chrome.css", "square-content.css"] {
        fs::copy(config_dir().join(name), directory.path().join(name)).unwrap();
    }
    for (template, expected) in [
        ("{{unknown}}", "Unknown Zen theme token"),
        ("{{colors.accent", "unclosed theme token"),
    ] {
        fs::write(directory.path().join("userChrome.css"), template).unwrap();
        assert!(
            render(directory.path(), &theme())
                .err()
                .unwrap()
                .to_string()
                .contains(expected)
        );
    }
}

#[test]
fn defaults_include_only_ublock_origin_and_bitwarden_and_schema_rejects_unsafe_settings() {
    let settings = luna_next_hocon::load(config_dir().join("settings.conf")).unwrap();
    let schema: Value =
        serde_json::from_slice(&fs::read(config_dir().join("settings.schema.json")).unwrap())
            .unwrap();
    luna_next_hocon::validate_value(&settings, &schema).unwrap();
    let extensions = settings["extensions"].as_array().unwrap();
    assert_eq!(extensions.len(), 2);
    assert_eq!(extensions[0]["id"], "uBlock0@raymondhill.net");
    assert_eq!(
        extensions[1]["id"],
        "{446900e4-71c2-419f-a6a7-df9c091e268b}"
    );
    assert!(!settings.to_string().contains("darkreader"));

    for (field, invalid) in [
        ("id", "../../unsafe"),
        (
            "url",
            "http://addons.mozilla.org/firefox/downloads/latest/example/latest.xpi",
        ),
        ("url", "https://example.com/latest.xpi"),
        (
            "url",
            "https://addons.mozilla.org/firefox/downloads/latest/example/latest.xpi?other=1",
        ),
    ] {
        let mut changed = settings.clone();
        changed["extensions"][0][field] = json!(invalid);
        assert!(
            luna_next_hocon::validate_value(&changed, &schema).is_err(),
            "{field}: {invalid}"
        );
    }
}
