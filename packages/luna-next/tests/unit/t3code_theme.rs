use super::*;

#[test]
fn a_native_settings_edit_during_staging_is_preserved() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("client-settings.json");
    fs::write(&path, "{\"fontFamilySans\":\"Old\"}\n").unwrap();
    let mut document = Document::open(&path, json!({})).unwrap();
    document.value["fontFamilySans"] = json!("Luna");
    document.stage().unwrap();
    let external = "{\"fontFamilySans\":\"External\"}\n";
    fs::write(&path, external).unwrap();
    assert!(
        document
            .publish()
            .unwrap_err()
            .to_string()
            .contains("changed externally")
    );
    assert_eq!(fs::read_to_string(&path).unwrap(), external);
}

#[test]
fn a_settings_file_created_during_staging_is_preserved() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("client-settings.json");
    let mut document = Document::open(&path, json!({"fontFamilySans": "Luna"})).unwrap();
    document.stage().unwrap();
    let external = "{\"notificationMode\":\"sound\"}\n";
    fs::write(&path, external).unwrap();
    assert!(document.publish().is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), external);
}
