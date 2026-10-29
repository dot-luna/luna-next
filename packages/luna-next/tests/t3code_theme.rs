use std::{
    fs,
    os::unix::fs::{PermissionsExt, symlink},
};

use luna_next::theme::{Paths, Themes};
use serde_json::{Value, json};

fn fixture(root: &std::path::Path) -> Themes {
    Themes::new(Paths {
        config_file: root.join("config/theme.conf"),
        library_dir: root.join("themes"),
        wallpaper_dir: root.join("wallpapers"),
    })
    .unwrap()
}

#[test]
fn native_t3_theme_and_fonts_follow_luna_while_other_preferences_and_links_survive() {
    let root = tempfile::tempdir().unwrap();
    let themes = fixture(root.path());
    let source = root.path().join("source");
    fs::create_dir(&source).unwrap();
    fs::write(source.join("theme.conf"), "colors { mode = light, accent = \"#123456\" }\nfonts { ui = \"Custom UI\", mono = \"Custom Mono\" }\n").unwrap();
    themes.install(&source, Some("custom"), false).unwrap();
    fs::write(themes.config_file(), "theme { name = custom }\n").unwrap();
    let state = root.path().join("T3 data/userdata");
    fs::create_dir_all(&state).unwrap();
    let client = root.path().join("client-settings.json");
    fs::write(&client, r#"{"onboardingCompletedAt":"completed","notificationMode":"sound","fontFamilySans":"Old UI","fontSizeInterface":15,"mathRenderingEnabled":false}"#).unwrap();
    fs::set_permissions(&client, fs::Permissions::from_mode(0o640)).unwrap();
    symlink(&client, state.join("client-settings.json")).unwrap();
    fs::write(
        state.join("settings.json"),
        r#"{"projectSettingsFolded":true}"#,
    )
    .unwrap();
    themes.apply_t3code(&state).unwrap();
    let palette_path = state.join("themes/luna-next.json");
    let palette: Value = serde_json::from_slice(&fs::read(&palette_path).unwrap()).unwrap();
    assert_eq!(palette["appearance"], "light");
    assert_eq!(palette["canvas"], "#e1e2e7");
    assert_eq!(palette["accent"], "#123456");
    assert_eq!(palette["colors"]["sidebar"], "#d5d6db");
    assert_eq!(palette["colors"]["codeBackground"], "#c4c5cb");
    assert_eq!(palette["colors"]["accentForeground"], "#ffffff");
    let settings: Value = serde_json::from_slice(&fs::read(&client).unwrap()).unwrap();
    assert_eq!(settings["fontFamilySans"], "Custom UI");
    assert_eq!(settings["fontFamilyComposer"], "Custom UI");
    assert_eq!(settings["fontFamilyCode"], "Custom Mono");
    assert_eq!(settings["fontFamilyTerminal"], "Custom Mono");
    assert_eq!(settings["fontSizeInterface"], 15);
    assert_eq!(settings["onboardingCompletedAt"], "completed");
    assert_eq!(settings["notificationMode"], "sound");
    assert_eq!(settings["mathRenderingEnabled"], true);
    assert!(
        fs::symlink_metadata(state.join("client-settings.json"))
            .unwrap()
            .is_symlink()
    );
    assert_eq!(
        fs::metadata(&client).unwrap().permissions().mode() & 0o777,
        0o640
    );
    let server: Value =
        serde_json::from_slice(&fs::read(state.join("settings.json")).unwrap()).unwrap();
    assert_eq!(server["projectSettingsFolded"], true);
    assert_eq!(server["defaultTheme"], "luna-next");
    assert!(server["defaultThemeSetAt"].as_str().unwrap().len() > 10);
    let previous = [
        fs::read(&palette_path).unwrap(),
        fs::read(&client).unwrap(),
        fs::read(state.join("settings.json")).unwrap(),
    ];
    themes.apply_t3code(&state).unwrap();
    assert_eq!(fs::read(&palette_path).unwrap(), previous[0]);
    assert_eq!(fs::read(&client).unwrap(), previous[1]);
    assert_eq!(fs::read(state.join("settings.json")).unwrap(), previous[2]);
    let installed = themes.path("custom").unwrap().join("theme.conf");
    fs::write(installed, "colors { accent = \"#ffffff\" }\n").unwrap();
    themes.apply_t3code(&state).unwrap();
    let palette: Value = serde_json::from_slice(&fs::read(&palette_path).unwrap()).unwrap();
    assert_eq!(palette["appearance"], "dark");
    assert_eq!(palette["accent"], "#ffffff");
    assert_eq!(palette["colors"]["accentForeground"], "#000000");
    let updated: Value =
        serde_json::from_slice(&fs::read(state.join("settings.json")).unwrap()).unwrap();
    assert_ne!(updated["defaultThemeSetAt"], server["defaultThemeSetAt"]);
}

#[test]
fn invalid_native_settings_fail_before_any_t3_file_is_published() {
    let root = tempfile::tempdir().unwrap();
    let themes = fixture(root.path());
    let state = root.path().join("userdata");
    fs::create_dir(&state).unwrap();
    for invalid in ["{", "[]", "null", "{\"settings\":{}}"] {
        fs::write(state.join("client-settings.json"), invalid).unwrap();
        assert!(themes.apply_t3code(&state).is_err());
        assert!(!state.join("themes/luna-next.json").exists());
        assert!(!state.join("settings.json").exists());
        assert_eq!(
            fs::read_to_string(state.join("client-settings.json")).unwrap(),
            invalid
        );
    }
    fs::write(state.join("client-settings.json"), "{}\n").unwrap();
    fs::write(state.join("settings.json"), "invalid\n").unwrap();
    assert!(themes.apply_t3code(&state).is_err());
    assert!(!state.join("themes/luna-next.json").exists());
    assert_eq!(
        fs::read_to_string(state.join("client-settings.json")).unwrap(),
        "{}\n"
    );
}

#[test]
fn an_unselected_theme_applies_the_bundled_defaults_without_modifying_selection() {
    let root = tempfile::tempdir().unwrap();
    let themes = fixture(root.path());
    themes.apply_t3code(&root.path().join("userdata")).unwrap();
    let preferences: Value = serde_json::from_slice(
        &fs::read(root.path().join("userdata/client-settings.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(preferences["fontFamilySans"], "Outfit");
    assert_eq!(preferences["fontFamilyTerminal"], "Iosevka Nerd Font");
    assert_eq!(themes.current().unwrap(), None);
    assert_eq!(themes.get(Some("colors.accent")).unwrap(), json!("#7aa2f7"));
    assert_eq!(fs::read_to_string(themes.config_file()).unwrap(), "");
}

#[test]
fn generated_theme_links_are_rejected_because_t3_does_not_publish_them() {
    let root = tempfile::tempdir().unwrap();
    let themes = fixture(root.path());
    let state = root.path().join("userdata");
    fs::create_dir_all(state.join("themes")).unwrap();
    let external = root.path().join("external.json");
    fs::write(&external, "{}\n").unwrap();
    symlink(&external, state.join("themes/luna-next.json")).unwrap();
    assert!(
        themes
            .apply_t3code(&state)
            .unwrap_err()
            .to_string()
            .contains("symlinks")
    );
    assert_eq!(fs::read_to_string(external).unwrap(), "{}\n");
    assert!(!state.join("client-settings.json").exists());
}
