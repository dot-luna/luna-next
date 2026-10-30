use std::{env, fs, os::unix::fs::PermissionsExt, path::PathBuf, process::Command, time::Duration};

use crate::{Error, Result, io_error, process};

pub(super) fn git_name() -> Result<String> {
    let output = process::run(
        Command::new("git").args(["config", "--global", "--get", "user.name"]),
        Duration::from_secs(10),
    )?;
    if !output.status.success()
        || output.stdout.trim().is_empty()
        || output.stdout.trim().chars().any(char::is_control)
    {
        return Err(Error::Message(
            "Set a nonempty global Git user.name before creating a Chromium profile".into(),
        ));
    }
    Ok(output.stdout.trim().to_owned())
}

pub(super) fn locate() -> Result<(PathBuf, String)> {
    let installed = process::run(
        Command::new("pacman").args(["-Q", "ungoogled-chromium-bin"]),
        Duration::from_secs(10),
    )?;
    if !installed.status.success() {
        return Err(Error::Message(
            "Install ungoogled-chromium-bin first: luna install ungoogled-chromium-bin".into(),
        ));
    }
    let binary = env::split_paths(&env::var_os("PATH").unwrap_or_default())
        .map(|directory| directory.join("chromium"))
        .find(|candidate| {
            fs::metadata(candidate).is_ok_and(|metadata| {
                metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
            })
        })
        .ok_or_else(|| Error::Message("The chromium executable is missing from PATH".into()))?;
    let binary = fs::canonicalize(&binary)
        .map_err(|error| io_error("locate Chromium executable", &binary, error))?;
    let output = process::run(
        Command::new(&binary).arg("--version"),
        Duration::from_secs(10),
    )?;
    let version_text = output.stdout.clone();
    process::checked("read Chromium version", output)?;
    let version = version_text
        .split_whitespace()
        .find(|part| {
            let numbers: Vec<_> = part.split('.').collect();
            numbers.len() == 4
                && numbers.iter().all(|number| {
                    !number.is_empty() && number.bytes().all(|character| character.is_ascii_digit())
                })
        })
        .ok_or_else(|| Error::Message("Cannot read the installed Chromium version".into()))?;
    Ok((binary, version.to_owned()))
}
