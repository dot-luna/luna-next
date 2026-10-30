use super::*;

#[test]
fn quotes_exec_arguments_and_escapes_desktop_fields_separately() {
    let entry = entry(
        "Name \\ %f",
        "https://example.com/%25?x=$`\"",
        Path::new("/bin/luna %f"),
        Some(Path::new("/profile/Quoted \" \\")),
        Path::new("/icons/name\\icon.png"),
    )
    .unwrap();
    assert!(entry.contains("Name=Name \\\\ %f\n"));
    assert!(entry.contains("\"/bin/luna %%f\" webapp launch"));
    assert!(entry.contains("https://example.com/%%25?x=\\\\$\\\\`\\\\\""));
    assert!(entry.contains("Icon=/icons/name\\\\icon.png\n"));
    assert!(!entry.contains("%U"));
}
