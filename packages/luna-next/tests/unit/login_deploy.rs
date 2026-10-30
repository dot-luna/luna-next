use super::validate_sddm_precedence;
use std::{fs, path::Path};

fn write(path: &Path, contents: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, contents).unwrap();
}

#[test]
fn main_configuration_theme_keys_override_the_managed_dropin() {
    let temporary = tempfile::tempdir().unwrap();
    let main = temporary.path().join("sddm.conf");
    let managed = temporary.path().join("sddm.conf.d/90-luna-next.conf");
    for settings in [
        "[Theme]\nCurrent=other\n",
        "[Theme] # inline comment\nThemeDir=/other/themes\n",
    ] {
        write(&main, settings);
        let error = validate_sddm_precedence(&main, &managed)
            .unwrap_err()
            .to_string();
        assert!(error.contains("overrides"), "{error}");
        assert!(error.contains("sddm.conf"), "{error}");
    }
}

#[test]
fn only_later_visible_dropins_with_theme_keys_block_publication() {
    let temporary = tempfile::tempdir().unwrap();
    let main = temporary.path().join("sddm.conf");
    let directory = temporary.path().join("sddm.conf.d");
    let managed = directory.join("90-luna-next.conf");
    write(&directory.join("10-old.conf"), "[Theme]\nCurrent=old\n");
    write(
        &directory.join(".99-hidden.conf"),
        "[Theme]\nCurrent=hidden\n",
    );
    write(
        &directory.join("99-other.conf"),
        "[General]\nHaltCommand=example\n",
    );
    write(
        &main,
        "# [Theme]\n# Current=commented\n[Users]\nCurrent=unused\n",
    );
    assert!(validate_sddm_precedence(&main, &managed).is_ok());
    let override_path = directory.join("99-overrides-without-extension");
    write(&override_path, "[Theme]\nCurrent=other\n");
    let error = validate_sddm_precedence(&main, &managed)
        .unwrap_err()
        .to_string();
    assert!(error.contains("99-overrides-without-extension"), "{error}");
}

#[test]
fn absent_local_configuration_is_supported() {
    let temporary = tempfile::tempdir().unwrap();
    assert!(
        validate_sddm_precedence(
            &temporary.path().join("sddm.conf"),
            &temporary.path().join("sddm.conf.d/90-luna-next.conf")
        )
        .is_ok()
    );
}
