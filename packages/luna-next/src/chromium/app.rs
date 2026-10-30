use std::{
    ffi::OsString,
    io::{Read, Seek, SeekFrom},
    path::Path,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

use super::{Launched, Paths, app_url, browser, profile};
use crate::{Error, Result, io_error};

pub(super) fn launch(paths: &Paths, value: &str, directory: Option<&Path>) -> Result<Launched> {
    let url = app_url(value)?;
    let target = profile::Target::resolve(paths, directory)?;
    let preferences = target.read_existing()?;
    let profile_name = profile::name(&preferences, &target.basename);
    let (binary, _) = browser::locate()?;
    let mut user_data_argument = OsString::from("--user-data-dir=");
    user_data_argument.push(&target.root);
    let mut diagnostics = tempfile::tempfile()
        .map_err(|error| io_error("capture Chromium launch errors", &binary, error))?;
    let mut child = Command::new(&binary)
        .arg(user_data_argument)
        .arg(format!("--profile-directory={}", target.basename))
        .args(["--no-first-run", "--no-default-browser-check"])
        .arg(format!("--app={url}"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        // Browser and handoff processes must not retain the CLI's captured output pipes.
        .stderr(Stdio::from(diagnostics.try_clone().map_err(|error| {
            io_error("capture Chromium launch errors", &binary, error)
        })?))
        .spawn()
        .map_err(|error| io_error("launch Chromium web app", &binary, error))?;

    // An existing singleton may be an active browser or a stale lock. Wait briefly for the
    // new process's own result rather than treating that marker as a successful handoff.
    let deadline = Instant::now() + Duration::from_millis(250);
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| io_error("check Chromium web app launch", &binary, error))?
        {
            if !status.success() {
                diagnostics
                    .seek(SeekFrom::Start(0))
                    .map_err(|error| io_error("read Chromium launch errors", &binary, error))?;
                let mut bytes = Vec::new();
                diagnostics
                    .take(16 * 1024)
                    .read_to_end(&mut bytes)
                    .map_err(|error| io_error("read Chromium launch errors", &binary, error))?;
                return Err(Error::Message(format!(
                    "Chromium could not launch the web app ({status}): {}",
                    String::from_utf8_lossy(&bytes).trim()
                )));
            }
            break;
        }
        if Instant::now() >= deadline {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(Launched {
        url: url.to_string(),
        profile: target.directory,
        profile_name,
    })
}

pub(crate) fn validate_url(value: &str) -> Result<url::Url> {
    if value.chars().any(char::is_control) || encoded_control(value) {
        return Err(Error::Message(
            "Web app URL must not contain control characters".into(),
        ));
    }
    let url = url::Url::parse(value)
        .map_err(|error| Error::Message(format!("Invalid web app URL: {error}")))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(Error::Message(
            "Web app URL must use HTTP or HTTPS and include a host".into(),
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(Error::Message(
            "Web app URL must not contain credentials".into(),
        ));
    }
    Ok(url)
}

fn encoded_control(value: &str) -> bool {
    value.as_bytes().windows(3).any(|bytes| {
        bytes[0] == b'%'
            && std::str::from_utf8(&bytes[1..])
                .ok()
                .and_then(|hex| u8::from_str_radix(hex, 16).ok())
                .is_some_and(|byte| byte < 0x20 || byte == 0x7f)
    })
}
