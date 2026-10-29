use super::{Import, apply};
use std::fs;
use std::path::Path;

fn entry(destination: &Path, previous: Option<fs::Metadata>) -> Import {
    Import {
        source: destination.with_extension("source"),
        destination: destination.to_owned(),
        added: true,
        previous,
    }
}

#[test]
fn a_destination_created_during_staging_is_preserved() {
    let temporary = tempfile::tempdir().unwrap();
    let transaction = tempfile::tempdir_in(temporary.path()).unwrap();
    let destination = temporary.path().join("wallpaper.png");
    let planned = entry(&destination, None);
    fs::write(transaction.path().join("new-0"), b"new wallpaper").unwrap();
    fs::write(&destination, b"external file").unwrap();

    assert!(apply(transaction, &[planned]).is_err());
    assert_eq!(fs::read(destination).unwrap(), b"external file");
}

#[test]
fn a_replacement_changed_during_staging_is_preserved() {
    let temporary = tempfile::tempdir().unwrap();
    let transaction = tempfile::tempdir_in(temporary.path()).unwrap();
    let destination = temporary.path().join("wallpaper.png");
    fs::write(&destination, b"old wallpaper").unwrap();
    let planned = entry(&destination, Some(fs::metadata(&destination).unwrap()));
    fs::write(transaction.path().join("new-0"), b"new wallpaper").unwrap();
    let external = temporary.path().join("replacement");
    fs::write(&external, b"external file").unwrap();
    fs::rename(external, &destination).unwrap();

    let error = apply(transaction, &[planned]).unwrap_err();
    assert!(error.to_string().contains("changed during import"));
    assert_eq!(fs::read(destination).unwrap(), b"external file");
}

#[test]
fn an_in_place_edit_during_staging_is_preserved() {
    let temporary = tempfile::tempdir().unwrap();
    let transaction = tempfile::tempdir_in(temporary.path()).unwrap();
    let destination = temporary.path().join("wallpaper.png");
    fs::write(&destination, b"old wallpaper").unwrap();
    let planned = entry(&destination, Some(fs::metadata(&destination).unwrap()));
    fs::write(transaction.path().join("new-0"), b"new wallpaper").unwrap();
    fs::write(&destination, b"externally edited wallpaper").unwrap();

    assert!(apply(transaction, &[planned]).is_err());
    assert_eq!(
        fs::read(destination).unwrap(),
        b"externally edited wallpaper"
    );
}

#[test]
fn a_late_conflict_rolls_back_earlier_imports() {
    let temporary = tempfile::tempdir().unwrap();
    let transaction = tempfile::tempdir_in(temporary.path()).unwrap();
    let first = temporary.path().join("first.png");
    let second = temporary.path().join("second.png");
    fs::write(&first, b"old wallpaper").unwrap();
    let plan = [
        entry(&first, Some(fs::metadata(&first).unwrap())),
        entry(&second, None),
    ];
    fs::write(transaction.path().join("new-0"), b"new wallpaper").unwrap();
    fs::write(transaction.path().join("new-1"), b"another wallpaper").unwrap();
    fs::write(&second, b"external file").unwrap();

    assert!(apply(transaction, &plan).is_err());
    assert_eq!(fs::read(first).unwrap(), b"old wallpaper");
    assert_eq!(fs::read(second).unwrap(), b"external file");
}
