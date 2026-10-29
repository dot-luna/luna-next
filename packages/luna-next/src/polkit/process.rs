use std::{
    env,
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    os::unix::{fs::PermissionsExt, process::CommandExt},
    path::{Path, PathBuf},
    process::{Command, ExitStatus, Stdio},
    thread,
    time::{Duration, Instant},
};

use crate::{Error, Result, io_error};

pub(super) struct Output {
    pub status: ExitStatus,
    pub stdout: String,
    pub stderr: String,
}

pub(super) fn quickshell() -> Result<PathBuf> {
    for name in ["qs", "quickshell"] {
        for directory in env::split_paths(&env::var_os("PATH").unwrap_or_default()) {
            let candidate = directory.join(name);
            if fs::metadata(&candidate).is_ok_and(|metadata| {
                metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
            }) {
                return Ok(candidate);
            }
        }
    }
    Err(Error::Message(
        "Quickshell is not installed or is missing from PATH".into(),
    ))
}

/// A separate process group lets a timeout also release validation helpers.
/// Temporary files avoid deadlock if a command fills an inherited output pipe.
pub(super) fn run(command: &mut Command, timeout: Duration) -> Result<Output> {
    let executable = PathBuf::from(command.get_program());
    let mut stdout = tempfile::tempfile()
        .map_err(|error| io_error("capture command output", &executable, error))?;
    let mut stderr = tempfile::tempfile()
        .map_err(|error| io_error("capture command errors", &executable, error))?;
    command
        .stdin(Stdio::null())
        .stdout(
            stdout
                .try_clone()
                .map_err(|error| io_error("capture command output", &executable, error))?,
        )
        .stderr(
            stderr
                .try_clone()
                .map_err(|error| io_error("capture command errors", &executable, error))?,
        )
        .process_group(0);
    let mut child = command
        .spawn()
        .map_err(|error| io_error("run command", &executable, error))?;
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(10)),
            result => {
                // The child owns this process group; never signal the invoking CLI.
                unsafe {
                    libc::kill(-(child.id() as i32), libc::SIGKILL);
                }
                let _ = child.kill();
                let _ = child.wait();
                return match result {
                    Err(error) => Err(io_error("wait for command", &executable, error)),
                    _ => Err(Error::Message(format!(
                        "{} timed out",
                        executable.display()
                    ))),
                };
            }
        }
    };
    Ok(Output {
        status,
        stdout: read(&mut stdout, &executable)?,
        stderr: read(&mut stderr, &executable)?,
    })
}

fn read(file: &mut File, executable: &Path) -> Result<String> {
    file.seek(SeekFrom::Start(0))
        .map_err(|error| io_error("read command output", executable, error))?;
    let mut bytes = Vec::new();
    file.take(1024 * 1024)
        .read_to_end(&mut bytes)
        .map_err(|error| io_error("read command output", executable, error))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

pub(super) fn checked(action: &str, output: Output) -> Result<()> {
    if output.status.success() {
        return Ok(());
    }
    let detail = if output.stderr.trim().is_empty() {
        output.stdout.trim()
    } else {
        output.stderr.trim()
    };
    Err(Error::Message(format!(
        "Could not {action} ({}): {detail}",
        output.status
    )))
}
