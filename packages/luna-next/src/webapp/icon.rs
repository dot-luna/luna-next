use std::{
    collections::HashSet,
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, Instant},
};

use html5gum::{DefaultEmitter, Token, Tokenizer};
use url::Url;

use crate::{Error, Result, chromium::app_url, io_error, process};

const MAX_HTML: u64 = 1024 * 1024;
const MAX_ICON: u64 = 5 * 1024 * 1024;
const MAX_DECLARED_ICONS: usize = 6;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const TOTAL_TIMEOUT: Duration = Duration::from_secs(45);

/// Stage an image with its detected extension; publication belongs to the caller.
/// An explicit icon URL bypasses page discovery. Automatic discovery tries declared
/// icons followed by origin defaults, within one time and candidate budget.
pub(super) fn prepare(url: &Url, icon_url: Option<&str>, stage: &Path) -> Result<PathBuf> {
    let deadline = Instant::now() + TOTAL_TIMEOUT;
    let candidates = if let Some(value) = icon_url {
        vec![app_url(value)?]
    } else {
        let mut document_url = url.clone();
        let mut candidates = Vec::new();
        if let Ok((mut page, effective_url)) = download(url, stage, MAX_HTML, deadline) {
            document_url = effective_url;
            let mut html = Vec::new();
            page.as_file_mut()
                .take(MAX_HTML + 1)
                .read_to_end(&mut html)
                .map_err(|error| io_error("read web app page", page.path(), error))?;
            candidates = declared_icons(&html, &document_url);
        }
        for path in ["/apple-touch-icon.png", "/favicon.ico"] {
            let fallback = document_url.join(path).expect("origin icon path is valid");
            if !candidates.contains(&fallback) {
                candidates.push(fallback);
            }
        }
        candidates
    };

    let mut last_error = String::new();
    for candidate in candidates {
        let attempt: Result<PathBuf> = (|| {
            let (download, _) = download(&candidate, stage, MAX_ICON, deadline)?;
            let extension = image_extension(download.path(), deadline)?;
            let destination = stage.join(format!("icon.{extension}"));
            fs::rename(download.path(), &destination)
                .map_err(|error| io_error("stage web app icon", &destination, error))?;
            Ok(destination)
        })();
        match attempt {
            Ok(path) => return Ok(path),
            Err(error) => last_error = error.to_string(),
        }
        if Instant::now() >= deadline {
            break;
        }
    }
    Err(Error::Message(format!(
        "Could not download a usable web app icon. Provide an image URL with --icon-url URL. Last attempt: {last_error}"
    )))
}

fn download(
    url: &Url,
    stage: &Path,
    maximum: u64,
    deadline: Instant,
) -> Result<(tempfile::NamedTempFile, Url)> {
    let timeout = remaining(deadline)?.min(REQUEST_TIMEOUT);
    let file = tempfile::NamedTempFile::new_in(stage)
        .map_err(|error| io_error("stage web app download", stage, error))?;
    let mut command = Command::new("curl");
    // Ignore curlrc so output paths, credentials, and allowed schemes stay controlled.
    command
        .args([
            "--disable",
            "--fail",
            "--location",
            "--silent",
            "--show-error",
            "--globoff",
            "--disallow-username-in-url",
            "--proto",
            "=http,https",
            "--proto-redir",
            "=http,https",
            "--max-redirs",
            "5",
            "--connect-timeout",
            "3",
            "--max-time",
        ])
        .arg(format!("{:.3}", timeout.as_secs_f64()))
        .arg("--max-filesize")
        .arg(maximum.to_string())
        .arg("--output")
        .arg(file.path())
        .args(["--write-out", "%{url_effective}", "--url"])
        .arg(url.as_str());
    let output = process::run(&mut command, timeout)?;
    let effective_url = output.stdout.trim().to_owned();
    process::checked("download web app icon or page", output)?;
    let metadata = file
        .as_file()
        .metadata()
        .map_err(|error| io_error("inspect web app download", file.path(), error))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > maximum {
        return Err(Error::Message(format!(
            "Web app download is empty or exceeds {maximum} bytes"
        )));
    }
    Ok((file, app_url(&effective_url)?))
}

fn image_extension(path: &Path, deadline: Instant) -> Result<&'static str> {
    let mut command = Command::new("file");
    command.args(["--brief", "--mime-type", "--"]).arg(path);
    let output = process::run(
        &mut command,
        remaining(deadline)?.min(Duration::from_secs(2)),
    )?;
    let mime = output.stdout.trim().to_owned();
    process::checked("identify web app icon image", output)?;
    match mime.as_str() {
        "image/png" => Ok("png"),
        "image/jpeg" => Ok("jpg"),
        "image/gif" => Ok("gif"),
        "image/webp" => Ok("webp"),
        "image/svg+xml" => Ok("svg"),
        "image/x-icon" | "image/vnd.microsoft.icon" => Ok("ico"),
        "image/bmp" | "image/x-ms-bmp" => Ok("bmp"),
        "image/tiff" => Ok("tiff"),
        "image/x-xpixmap" => Ok("xpm"),
        _ => Err(Error::Message(format!(
            "Downloaded web app icon is not a supported image ({mime})"
        ))),
    }
}

fn remaining(deadline: Instant) -> Result<Duration> {
    deadline
        .checked_duration_since(Instant::now())
        .filter(|duration| !duration.is_zero())
        .ok_or_else(|| Error::Message("Web app icon discovery timed out".into()))
}

fn declared_icons(html: &[u8], document_url: &Url) -> Vec<Url> {
    let mut emitter = DefaultEmitter::default();
    // State switching excludes tag-like text inside scripts, styles, and text areas.
    emitter.naively_switch_states(true);
    let mut templates = 0usize;
    let mut first_base = None;
    let mut links = Vec::new();
    for token in Tokenizer::new_with_emitter(html, emitter).flatten() {
        match token {
            Token::StartTag(tag) if tag.name.as_ref() == b"template" => templates += 1,
            Token::EndTag(tag) if tag.name.as_ref() == b"template" => {
                templates = templates.saturating_sub(1);
            }
            Token::StartTag(tag) if templates == 0 => {
                let attribute = |name: &[u8]| {
                    tag.attributes
                        .get(name)
                        .and_then(|value| std::str::from_utf8(&value.value).ok())
                };
                if tag.name.as_ref() == b"base" && first_base.is_none() {
                    if let Some(href) = attribute(b"href") {
                        first_base = Some(href.to_owned());
                    }
                }
                if tag.name.as_ref() != b"link" {
                    continue;
                }
                let (Some(rel), Some(href)) = (attribute(b"rel"), attribute(b"href")) else {
                    continue;
                };
                let tokens: Vec<_> = rel.split_ascii_whitespace().collect();
                let apple = tokens.iter().any(|token| {
                    token.eq_ignore_ascii_case("apple-touch-icon")
                        || token.eq_ignore_ascii_case("apple-touch-icon-precomposed")
                });
                if apple
                    || tokens
                        .iter()
                        .any(|token| token.eq_ignore_ascii_case("icon"))
                {
                    links.push((!apple, href.to_owned()));
                }
            }
            _ => {}
        }
    }
    let base = first_base
        .as_deref()
        .and_then(|href| resolve_url(document_url, href))
        .unwrap_or_else(|| document_url.clone());
    links.sort_by_key(|(ordinary, _)| *ordinary);
    let mut seen = HashSet::new();
    links
        .into_iter()
        .filter_map(|(_, href)| resolve_url(&base, &href))
        .filter(|url| seen.insert(url.clone()))
        .take(MAX_DECLARED_ICONS)
        .collect()
}

fn resolve_url(base: &Url, value: &str) -> Option<Url> {
    if value.chars().any(char::is_control) {
        return None;
    }
    let url = base.join(value.trim()).ok()?;
    app_url(url.as_str()).ok()
}

#[cfg(test)]
#[path = "../../tests/unit/webapp_icons.rs"]
mod tests;
