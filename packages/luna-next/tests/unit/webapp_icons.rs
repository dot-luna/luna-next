use std::{os::unix::fs::PermissionsExt, process::Command};

use serde_json::{Value, json};

use super::*;

fn document() -> Url {
    app_url("https://example.com/new/path/index.html").unwrap()
}

fn discovered(html: &str) -> Vec<String> {
    declared_icons(html.as_bytes(), &document())
        .into_iter()
        .map(|url| url.to_string())
        .collect()
}

#[test]
fn discovers_relative_cdn_entity_and_apple_icons_with_first_base() {
    assert_eq!(
        discovered(
            r#"<LINK href='normal.png?a=1&amp;b=2' REL='shortcut ICON'>
            <base href='/assets/'><base href='https://ignored.example/'>
            <link rel='APPLE-TOUCH-ICON' href='//cdn.example/apple.png'>
            <link rel='apple-touch-icon-precomposed' href='square.png'>
            <link rel='icon' href='normal.png?a=1&amp;b=2'>"#,
        ),
        [
            "https://cdn.example/apple.png",
            "https://example.com/assets/square.png",
            "https://example.com/assets/normal.png?a=1&b=2",
        ]
    );
}

#[test]
fn ignores_script_style_textarea_comment_and_template_links() {
    assert_eq!(
        discovered(
            r#"<script>let icon = '<link rel="icon" href="script.png">';</script>
            <style>x::after {content: '<link rel="icon" href="style.png">'}</style>
            <textarea><link rel='icon' href='textarea.png'></textarea>
            <!-- <link rel='icon' href='comment.png'> -->
            <template><base href='https://wrong.example/'><template>
            <link rel='icon' href='inner.png'></template>
            <link rel='icon' href='template.png'></template>
            <link rel='icon' href='actual.png'>"#,
        ),
        ["https://example.com/new/path/actual.png"]
    );
}

#[test]
fn rejects_unsafe_candidates_and_limits_unique_declared_icons() {
    let mut html = String::from(
        r#"<base href='javascript:bad'><base href='https://ignored.example/'>
        <link rel='icon' href='data:image/png,bad'>
        <link rel='icon' href='https://user:password@example.com/icon.png'>
        <link rel='icon' href='/newline&#10;icon.png'>
        <link rel='icon' href='/encoded%0aicon.png'>
        <link rel='mask-icon' href='mask.svg'>"#,
    );
    for index in 0..20 {
        html.push_str(&format!(
            "<link rel=icon href='{index}.png'><link rel=icon href='{index}.png'>"
        ));
    }
    let urls = discovered(&html);
    assert_eq!(urls.len(), MAX_DECLARED_ICONS);
    assert_eq!(urls[0], "https://example.com/new/path/0.png");
    assert_eq!(urls[5], "https://example.com/new/path/5.png");
}

struct Fixture {
    directory: tempfile::TempDir,
}

impl Fixture {
    fn new(config: Value) -> Self {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir(directory.path().join("bin")).unwrap();
        fs::create_dir(directory.path().join("stage")).unwrap();
        fs::write(directory.path().join("stage/sentinel"), "unrelated").unwrap();
        fs::write(
            directory.path().join("fixture.json"),
            serde_json::to_vec(&config).unwrap(),
        )
        .unwrap();
        let curl = directory.path().join("bin/curl");
        fs::write(
            &curl,
            r#"#!/usr/bin/python3
import json, os, pathlib, sys
root = pathlib.Path(os.environ['LUNA_ICON_TEST_FIXTURE'])
args = sys.argv[1:]
with (root/'calls.jsonl').open('a') as log:
    log.write(json.dumps({'command': 'curl', 'args': args})+'\n')
config = json.loads((root/'fixture.json').read_text())
url = args[args.index('--url')+1]
response = config['responses'].get(url)
if response is None:
    print('fixture HTTP 404', file=sys.stderr)
    sys.exit(22)
if 'exit' in response:
    sys.exit(response['exit'])
destination = pathlib.Path(args[args.index('--output')+1])
destination.write_bytes(response.get('body','').encode() if 'size' not in response else b'P'*response['size'])
print(response.get('effective', url), end='')
"#,
        )
        .unwrap();
        let file = directory.path().join("bin/file");
        fs::write(
            &file,
            r#"#!/usr/bin/python3
import json, os, pathlib, sys
root = pathlib.Path(os.environ['LUNA_ICON_TEST_FIXTURE'])
args = sys.argv[1:]
with (root/'calls.jsonl').open('a') as log:
    log.write(json.dumps({'command': 'file', 'args': args})+'\n')
data = pathlib.Path(args[-1]).read_bytes()
formats = {'PNG': 'image/png', 'SVG': 'image/svg+xml', 'ICO': 'image/vnd.microsoft.icon',
           'JPG': 'image/jpeg', 'WEBP': 'image/webp', 'GIF': 'image/gif',
           'BMP': 'image/x-ms-bmp', 'TIFF': 'image/tiff', 'XPM': 'image/x-xpixmap'}
print(formats.get(data.decode(errors='replace'), 'text/html'))
"#,
        )
        .unwrap();
        for command in [&curl, &file] {
            fs::set_permissions(command, fs::Permissions::from_mode(0o755)).unwrap();
        }
        Self { directory }
    }

    fn run(&self) {
        let path = std::env::join_paths(
            [self.directory.path().join("bin")]
                .into_iter()
                .chain(std::env::split_paths(&std::env::var_os("PATH").unwrap())),
        )
        .unwrap();
        let output = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "webapp::icon::tests::prepare_in_child",
                "--nocapture",
            ])
            .env("LUNA_ICON_TEST_FIXTURE", self.directory.path())
            .env("PATH", path)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn calls(&self) -> Vec<Value> {
        fs::read_to_string(self.directory.path().join("calls.jsonl"))
            .unwrap_or_default()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }
}

#[test]
fn prepare_in_child() {
    let Some(root) = std::env::var_os("LUNA_ICON_TEST_FIXTURE") else {
        return;
    };
    let root = PathBuf::from(root);
    let config: Value =
        serde_json::from_slice(&fs::read(root.join("fixture.json")).unwrap()).unwrap();
    let result = prepare(
        &document(),
        config["icon_url"].as_str(),
        &root.join("stage"),
    );
    if let Some(extension) = config["extension"].as_str() {
        let path = result.unwrap();
        assert_eq!(path, root.join(format!("stage/icon.{extension}")));
        assert!(path.is_file());
        assert_eq!(fs::read_dir(root.join("stage")).unwrap().count(), 2);
    } else {
        let error = result.unwrap_err().to_string();
        assert!(error.contains(config["error"].as_str().unwrap()), "{error}");
        assert_eq!(fs::read_dir(root.join("stage")).unwrap().count(), 1);
    }
    assert_eq!(
        fs::read_to_string(root.join("stage/sentinel")).unwrap(),
        "unrelated"
    );
}

#[test]
fn explicit_icon_skips_discovery_and_retains_detected_formats() {
    for (body, extension) in [
        ("PNG", "png"),
        ("SVG", "svg"),
        ("ICO", "ico"),
        ("JPG", "jpg"),
        ("WEBP", "webp"),
        ("GIF", "gif"),
        ("BMP", "bmp"),
        ("TIFF", "tiff"),
        ("XPM", "xpm"),
    ] {
        let fixture = Fixture::new(json!({
            "icon_url":"https://cdn.example/image?unknown-extension",
            "responses":{"https://cdn.example/image?unknown-extension":{"body":body}},
            "extension":extension,
        }));
        fixture.run();
        let calls = fixture.calls();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0]["command"], "curl");
        assert_eq!(calls[1]["command"], "file");
        assert_eq!(calls[1]["args"][0], "--brief");
        assert_eq!(calls[1]["args"][1], "--mime-type");
        assert_eq!(calls[1]["args"][2], "--");
    }
}

#[test]
fn discovery_uses_redirected_document_url_and_checks_safe_curl_options() {
    let fixture = Fixture::new(json!({
        "responses":{
            "https://example.com/new/path/index.html":{
                "body":"<link rel='icon' href='icon.png'>",
                "effective":"https://redirect.example/apps/page.html"
            },
            "https://redirect.example/apps/icon.png":{"body":"PNG"}
        },
        "extension":"png",
    }));
    fixture.run();
    let calls = fixture.calls();
    assert_eq!(calls.len(), 3);
    for call in calls.iter().filter(|call| call["command"] == "curl") {
        let args = call["args"].as_array().unwrap();
        assert_eq!(args[0], "--disable");
        for flag in [
            "--fail",
            "--location",
            "--silent",
            "--show-error",
            "--globoff",
            "--disallow-username-in-url",
        ] {
            assert!(args.contains(&json!(flag)), "missing {flag}");
        }
        for (flag, value) in [
            ("--proto", "=http,https"),
            ("--proto-redir", "=http,https"),
            ("--max-redirs", "5"),
            ("--connect-timeout", "3"),
            ("--write-out", "%{url_effective}"),
        ] {
            let index = args.iter().position(|arg| arg == flag).unwrap();
            assert_eq!(args[index + 1], value);
        }
        let limit_index = args.iter().position(|arg| arg == "--max-filesize").unwrap();
        let url_index = args.iter().position(|arg| arg == "--url").unwrap();
        assert_eq!(
            args[limit_index + 1],
            if args[url_index + 1] == document().as_str() {
                MAX_HTML.to_string()
            } else {
                MAX_ICON.to_string()
            }
        );
    }
}

#[test]
fn invalid_declared_image_uses_origin_icon_without_accepting_html() {
    let fixture = Fixture::new(json!({
        "responses":{
            "https://example.com/new/path/index.html":{"body":"<link rel=icon href=bad.png>"},
            "https://example.com/new/path/bad.png":{"body":"<html>not an image</html>"},
            "https://example.com/favicon.ico":{"body":"ICO"}
        },
        "extension":"ico",
    }));
    fixture.run();
    assert_eq!(
        fixture
            .calls()
            .iter()
            .filter(|call| call["command"] == "curl")
            .count(),
        4
    );
}

#[test]
fn request_failures_and_oversized_payloads_leave_staging_clean() {
    for response in [
        json!({"body":"<html>Error</html>"}),
        json!({"size":MAX_ICON + 1}),
        json!({"body":""}),
        json!({"exit":22}),
        json!({"body":"PNG", "effective":"file:///etc/passwd"}),
    ] {
        let fixture = Fixture::new(json!({
            "icon_url":"https://cdn.example/icon",
            "responses":{"https://cdn.example/icon":response},
            "error":"--icon-url URL",
        }));
        fixture.run();
    }
}

#[test]
fn unsafe_explicit_urls_fail_before_running_commands() {
    for value in [
        "file:///etc/passwd",
        "https://user:secret@example.com/icon.png",
        "https://example.com/%0aicon.png",
        "https://example.com/icon\n.png",
    ] {
        let fixture = Fixture::new(json!({
            "icon_url":value,
            "responses":{},
            "error":"URL",
        }));
        fixture.run();
        assert!(fixture.calls().is_empty());
    }
}

#[test]
fn automatic_candidates_remain_bounded_and_errors_offer_override() {
    let html = (0..100)
        .map(|index| format!("<link rel=icon href='/{index}.png'>"))
        .collect::<String>();
    let fixture = Fixture::new(json!({
        "responses":{"https://example.com/new/path/index.html":{"body":html}},
        "error":"--icon-url URL",
    }));
    fixture.run();
    assert_eq!(fixture.calls().len(), 1 + MAX_DECLARED_ICONS + 2);
    assert!(remaining(Instant::now() - Duration::from_millis(1)).is_err());
}
