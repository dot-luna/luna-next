use std::{fs, io::Write};

use super::*;

fn crx(manifest: Option<&[u8]>) -> Vec<u8> {
    let mut archive = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default();
    archive.start_file("payload.js", options).unwrap();
    archive.write_all(b"void 0;").unwrap();
    if let Some(manifest) = manifest {
        archive.start_file("manifest.json", options).unwrap();
        archive.write_all(manifest).unwrap();
    }
    let mut package = b"Cr24".to_vec();
    package.extend(3u32.to_le_bytes());
    package.extend(2u32.to_le_bytes());
    // Test packages contain framing only; a real browser rejects this unsigned header.
    package.extend([0x0a, 0x00]);
    package.extend(archive.finish().unwrap().into_inner());
    package
}

#[test]
fn reads_manifest_version_from_a_crx3_archive() {
    let package = crx(Some(br#"{"version":"25.5.1","manifest_version":3}"#));
    assert_eq!(manifest_version(&package).unwrap(), "25.5.1");
}

#[test]
fn rejects_invalid_crx_framing_and_archive() {
    let valid = crx(Some(br#"{"version":"1.0"}"#));
    for end in 0..14 {
        assert!(manifest_version(&valid[..end]).is_err());
    }
    let mut wrong_magic = valid.clone();
    wrong_magic[0] = b'X';
    assert!(manifest_version(&wrong_magic).is_err());
    let mut wrong_format = valid.clone();
    wrong_format[4..8].copy_from_slice(&2u32.to_le_bytes());
    assert!(manifest_version(&wrong_format).is_err());
    for size in [0u32, u32::MAX] {
        let mut wrong_size = valid.clone();
        wrong_size[8..12].copy_from_slice(&size.to_le_bytes());
        assert!(manifest_version(&wrong_size).is_err());
    }
    let mut broken_zip = valid.clone();
    broken_zip.truncate(broken_zip.len() - 10);
    assert!(manifest_version(&broken_zip).is_err());
}

#[test]
fn rejects_missing_invalid_and_oversized_manifests() {
    assert!(manifest_version(&crx(None)).is_err());
    for manifest in [b"not json".as_slice(), br#"{}"#, br#"{"version":2}"#] {
        assert!(manifest_version(&crx(Some(manifest))).is_err());
    }
    assert!(manifest_version(&crx(Some(&vec![b' '; MAX_MANIFEST as usize + 1]))).is_err());
}

#[test]
fn accepts_only_chromium_version_components() {
    for version in ["1", "0.1", "1.0.0.0", "65535.65535.65535.65535"] {
        assert!(valid_version(version), "{version}");
    }
    for version in [
        "",
        "0",
        "0.0.0",
        "1.02",
        "01",
        "1.",
        ".1",
        "1..2",
        "1.2.3.4.5",
        "65536",
        "1-beta",
        "-1",
        " 1",
        "１",
        "1/2",
    ] {
        assert!(!valid_version(version), "{version}");
    }
}

#[test]
fn rejects_invalid_and_duplicate_ids_before_downloads() {
    let stage = tempfile::tempdir().unwrap();
    let id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_owned();
    for ids in [
        vec![String::new()],
        vec!["../extension".into()],
        vec!["qaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into()],
        vec![id.clone(), "bad".into()],
        vec![id.clone(), id.clone()],
    ] {
        assert!(prepare(&ids, "156.0.8078.73", stage.path()).is_err());
        assert_eq!(fs::read_dir(stage.path()).unwrap().count(), 0);
    }
}

#[test]
fn rejects_downloads_above_the_file_size_limit() {
    let stage = tempfile::tempdir().unwrap();
    let path = stage.path().join("extension.crx");
    File::create(&path)
        .unwrap()
        .set_len(MAX_DOWNLOAD + 1)
        .unwrap();
    assert!(
        package_version(&path)
            .unwrap_err()
            .to_string()
            .contains("128 MiB")
    );
}
