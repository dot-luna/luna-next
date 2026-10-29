use luna_next::wallpaper::{AddOptions, Library};
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::Path;
use std::thread;
use std::time::{Duration, Instant};

const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x01\0\0\0\x01\x08\x06\0\0\0\x1f\x15\xc4\x89\0\0\0\x0bIDATx\x9cc\0\x01\0\0\x05\0\x01\r\n-\xb4\0\0\0\0IEND\xaeB`\x82";

fn image(path: &Path, variation: u8) {
    let mut bytes = PNG.to_vec();
    bytes.push(variation);
    fs::write(path, bytes).unwrap();
}

fn target(path: &Path) -> String {
    path.to_str().unwrap().to_owned()
}

fn options(force: bool, recursive: bool) -> AddOptions {
    AddOptions { force, recursive }
}

#[test]
fn missing_library_lists_empty_without_creating_it() {
    let temporary = tempfile::tempdir().unwrap();
    let directory = temporary.path().join("library");
    let library = Library::new(directory.clone());
    assert!(library.list().unwrap().is_empty());
    assert!(!directory.exists());
    assert!(library.random(None).is_err());
    assert!(library.resolve("missing.png", true).is_err());
}

#[test]
fn library_lock_blocks_other_mutations_and_is_not_listed() {
    let temporary = tempfile::tempdir().unwrap();
    let source = temporary.path().join("image.png");
    image(&source, 1);
    let directory = temporary.path().join("library");
    fs::create_dir(&directory).unwrap();
    let lock = fs::File::create(directory.join(".luna-next-media-lock")).unwrap();
    lock.try_lock().unwrap();
    let library = Library::new(directory);
    let error = library
        .add(&[target(&source)], &AddOptions::default())
        .unwrap_err();
    assert!(error.to_string().contains("busy"));
    assert!(library.list().unwrap().is_empty());
    drop(lock);
    assert!(
        library
            .add(&[target(&source)], &AddOptions::default())
            .unwrap()[0]
            .added
    );
    assert_eq!(library.list().unwrap().len(), 1);
}

#[test]
fn imports_by_content_and_skips_identical_files() {
    let temporary = tempfile::tempdir().unwrap();
    let source = temporary.path().join("no-extension");
    image(&source, 0);
    let library = Library::new(temporary.path().join("library"));
    let first = library
        .add(&[target(&source)], &AddOptions::default())
        .unwrap();
    assert_eq!(first.len(), 1);
    assert!(first[0].added);
    assert_eq!(
        fs::read(&source).unwrap(),
        fs::read(&first[0].path).unwrap()
    );
    let second = library
        .add(&[target(&source)], &options(true, false))
        .unwrap();
    assert!(!second[0].added);
    assert_eq!(library.list().unwrap(), vec![first[0].path.clone()]);
    assert_eq!(
        library.resolve("no-extension", true).unwrap(),
        first[0].path
    );
    assert_eq!(library.resolve(&target(&source), false).unwrap(), source);
}

#[test]
fn conflicting_batch_changes_nothing_and_force_replaces() {
    let temporary = tempfile::tempdir().unwrap();
    let source = temporary.path().join("image.png");
    image(&source, 1);
    let library = Library::new(temporary.path().join("library"));
    let installed = library
        .add(&[target(&source)], &AddOptions::default())
        .unwrap();
    let original = fs::read(&installed[0].path).unwrap();
    image(&source, 2);
    let extra = temporary.path().join("extra.png");
    image(&extra, 3);
    assert!(
        library
            .add(&[target(&extra), target(&source)], &AddOptions::default())
            .is_err()
    );
    assert!(!library.directory().join("extra.png").exists());
    assert_eq!(fs::read(&installed[0].path).unwrap(), original);
    let replaced = library
        .add(&[target(&source)], &options(true, false))
        .unwrap();
    assert!(replaced[0].added);
    assert_eq!(
        fs::read(&installed[0].path).unwrap(),
        fs::read(&source).unwrap()
    );
}

#[test]
fn malformed_media_rejects_entire_batch() {
    let temporary = tempfile::tempdir().unwrap();
    let source = temporary.path().join("image.png");
    image(&source, 1);
    let invalid = temporary.path().join("invalid.png");
    fs::write(&invalid, "this is text, not an image").unwrap();
    let library = Library::new(temporary.path().join("library"));
    assert!(
        library
            .add(&[target(&source), target(&invalid)], &options(false, false))
            .is_err()
    );
    assert!(!library.directory().exists());
}

#[test]
fn duplicate_names_are_checked_even_with_force() {
    let temporary = tempfile::tempdir().unwrap();
    let first = temporary.path().join("first");
    let second = temporary.path().join("second");
    fs::create_dir(&first).unwrap();
    fs::create_dir(&second).unwrap();
    image(&first.join("same.png"), 1);
    image(&second.join("same.png"), 2);
    let library = Library::new(temporary.path().join("library"));
    assert!(
        library
            .add(&[target(&first), target(&second)], &options(true, false))
            .is_err()
    );
    assert!(!library.directory().exists());
    image(&second.join("same.png"), 1);
    let result = library
        .add(&[target(&first), target(&second)], &options(false, false))
        .unwrap();
    assert_eq!(result.len(), 1);
}

#[test]
fn directory_import_is_sorted_and_recursion_is_explicit() {
    let temporary = tempfile::tempdir().unwrap();
    let source = temporary.path().join("source");
    let nested = source.join("nested");
    fs::create_dir_all(&nested).unwrap();
    image(&source.join("z.PNG"), 1);
    image(&nested.join("a.png"), 2);
    fs::write(source.join("readme.txt"), "ignored").unwrap();
    let library = Library::new(temporary.path().join("library"));
    let first = library
        .add(&[target(&source)], &AddOptions::default())
        .unwrap();
    assert_eq!(first.len(), 1);
    let second = library
        .add(&[target(&source)], &options(false, true))
        .unwrap();
    assert_eq!(second.len(), 2);
    assert_eq!(library.list().unwrap()[0].file_name().unwrap(), "a.png");
}

#[test]
fn removals_protect_current_and_external_files_and_prevalidate_batch() {
    let temporary = tempfile::tempdir().unwrap();
    let first = temporary.path().join("first.png");
    let second = temporary.path().join("second.png");
    image(&first, 1);
    image(&second, 2);
    let library = Library::new(temporary.path().join("library"));
    library
        .add(&[target(&first), target(&second)], &AddOptions::default())
        .unwrap();
    let current = library.resolve("first.png", true).unwrap();
    assert!(
        library
            .remove(&["first.png".into()], Some(&current))
            .is_err()
    );
    assert!(library.remove(&[target(&first)], None).is_err());
    assert!(
        library
            .remove(&["second.png".into(), "missing.png".into()], None)
            .is_err()
    );
    assert_eq!(library.list().unwrap().len(), 2);
    let removed = library
        .remove(&["second.png".into(), "second.png".into()], Some(&current))
        .unwrap();
    assert_eq!(removed.len(), 1);
    assert!(first.exists() && second.exists() && current.exists());
    assert_eq!(library.list().unwrap(), vec![current]);
}

#[test]
fn random_avoids_current_when_another_wallpaper_exists() {
    let temporary = tempfile::tempdir().unwrap();
    let first = temporary.path().join("first.png");
    let second = temporary.path().join("second.png");
    image(&first, 1);
    image(&second, 2);
    let library = Library::new(temporary.path().join("library"));
    library
        .add(&[target(&first)], &AddOptions::default())
        .unwrap();
    let current = library.resolve("first.png", true).unwrap();
    assert_eq!(library.random(Some(&current)).unwrap(), current);
    library
        .add(&[target(&second)], &AddOptions::default())
        .unwrap();
    assert_eq!(
        library.random(Some(&current)).unwrap(),
        library.resolve("second.png", true).unwrap()
    );
}

#[test]
fn duplicate_library_basenames_need_a_full_path() {
    let temporary = tempfile::tempdir().unwrap();
    let first = temporary.path().join("a");
    let second = temporary.path().join("b");
    fs::create_dir(&first).unwrap();
    fs::create_dir(&second).unwrap();
    image(&first.join("same.png"), 1);
    image(&second.join("same.png"), 2);
    let library = Library::new(temporary.path().to_owned());
    assert!(
        library
            .resolve("same.png", true)
            .unwrap_err()
            .to_string()
            .contains("Ambiguous")
    );
    assert_eq!(
        library
            .resolve(&target(&first.join("same.png")), true)
            .unwrap(),
        first.join("same.png")
    );
}

#[cfg(unix)]
#[test]
fn scans_do_not_follow_symlinks_and_imports_cannot_overwrite_them() {
    use std::os::unix::fs::symlink;
    let temporary = tempfile::tempdir().unwrap();
    let outside = temporary.path().join("outside");
    fs::create_dir(&outside).unwrap();
    let external = outside.join("image.png");
    image(&external, 1);
    let directory = temporary.path().join("library");
    fs::create_dir(&directory).unwrap();
    symlink(&outside, directory.join("linked-directory")).unwrap();
    symlink(&external, directory.join("image.png")).unwrap();
    let library = Library::new(directory);
    assert!(library.list().unwrap().is_empty());
    assert!(
        library
            .add(&[target(&external)], &options(true, false))
            .is_err()
    );
    assert!(library.remove(&["image.png".into()], None).is_err());
    assert_eq!(fs::read(&external).unwrap(), [PNG, &[1]].concat());
}

fn server(responses: Vec<Vec<u8>>) -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let worker = thread::spawn(move || {
        for response in responses {
            let started = Instant::now();
            loop {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        stream
                            .set_read_timeout(Some(Duration::from_secs(2)))
                            .unwrap();
                        let mut request = [0; 4096];
                        let _ = stream.read(&mut request).unwrap();
                        stream.write_all(&response).unwrap();
                        break;
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(
                            started.elapsed() < Duration::from_secs(5),
                            "HTTP request timed out"
                        );
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(error) => panic!("HTTP test server failed: {error}"),
                }
            }
        }
    });
    (address, worker)
}

fn response(body: &[u8]) -> Vec<u8> {
    [
        format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .as_bytes(),
        body,
    ]
    .concat()
}

#[test]
fn http_import_detects_extension_and_sanitizes_url_filename() {
    let temporary = tempfile::tempdir().unwrap();
    let library = Library::new(temporary.path().join("library"));
    let (address, worker) = server(vec![response(PNG)]);
    let imported = library
        .add(
            &[format!("{address}/a%2Fb%0A.jpeg?download=yes")],
            &AddOptions::default(),
        )
        .unwrap();
    worker.join().unwrap();
    assert_eq!(imported[0].path.file_name().unwrap(), "a_b_.png");
    assert_eq!(fs::read(&imported[0].path).unwrap(), PNG);
    assert_eq!(library.list().unwrap().len(), 1);
}

#[test]
fn http_failure_or_invalid_payload_does_not_modify_library() {
    let temporary = tempfile::tempdir().unwrap();
    let library = Library::new(temporary.path().join("library"));
    let (address, worker) = server(vec![response(b"not an image")]);
    assert!(
        library
            .add(&[format!("{address}/broken.png")], &AddOptions::default())
            .is_err()
    );
    worker.join().unwrap();
    assert!(!library.directory().exists());
    let (address, worker) = server(vec![
        b"HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec(),
    ]);
    assert!(
        library
            .add(&[format!("{address}/broken.png")], &AddOptions::default())
            .is_err()
    );
    worker.join().unwrap();
    assert!(!library.directory().exists());
}

#[test]
fn url_redirect_cannot_read_local_files() {
    let temporary = tempfile::tempdir().unwrap();
    let external = temporary.path().join("secret.png");
    image(&external, 4);
    let library = Library::new(temporary.path().join("library"));
    let redirect = format!(
        "HTTP/1.1 302 Found\r\nLocation: file://{}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        external.display()
    );
    let (address, worker) = server(vec![redirect.into_bytes()]);
    assert!(
        library
            .add(&[format!("{address}/redirect")], &AddOptions::default())
            .is_err()
    );
    worker.join().unwrap();
    assert!(!library.directory().exists());
    assert!(external.exists());
}
