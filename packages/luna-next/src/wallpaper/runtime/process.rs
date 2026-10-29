use super::Runtime;
use crate::{Error, Result, io_error};
use std::env;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const COMMAND_TIMEOUT: Duration = Duration::from_secs(5);

pub(super) struct Output {
    pub(super) status: ExitStatus,
    pub(super) stdout: String,
    pub(super) stderr: String,
}

impl Runtime {
    pub(super) fn run(&self, arguments: &[std::ffi::OsString], launch: bool) -> Result<Output> {
        let executable = quickshell()?;
        // Files keep large or inherited output pipes from blocking command waits.
        let mut stdout = tempfile::tempfile()
            .map_err(|error| io_error("capture Quickshell output", &executable, error))?;
        let mut stderr = tempfile::tempfile()
            .map_err(|error| io_error("capture Quickshell errors", &executable, error))?;
        let mut command = Command::new(&executable);
        command
            .args(arguments)
            .stdin(Stdio::null())
            .stdout(
                stdout
                    .try_clone()
                    .map_err(|error| io_error("capture Quickshell output", &executable, error))?,
            )
            .stderr(
                stderr
                    .try_clone()
                    .map_err(|error| io_error("capture Quickshell errors", &executable, error))?,
            );
        if launch {
            command
                .env("LUNA_WALLPAPER_CONFIG", self.config_path()?)
                .process_group(0);
        }
        let mut child = command
            .spawn()
            .map_err(|error| io_error("run Quickshell", &executable, error))?;
        let deadline = Instant::now() + COMMAND_TIMEOUT;
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(10)),
                Ok(None) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(Error::Message(
                        "Quickshell command timed out after five seconds".into(),
                    ));
                }
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(io_error("wait for Quickshell", &executable, error));
                }
            }
        };
        Ok(Output {
            status,
            stdout: read_output(&mut stdout, &executable)?,
            stderr: read_output(&mut stderr, &executable)?,
        })
    }
}

fn read_output(file: &mut fs::File, executable: &Path) -> Result<String> {
    file.seek(SeekFrom::Start(0))
        .map_err(|error| io_error("read Quickshell output", executable, error))?;
    let mut bytes = Vec::new();
    file.take(1024 * 1024)
        .read_to_end(&mut bytes)
        .map_err(|error| io_error("read Quickshell output", executable, error))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

pub(super) fn command_error(action: &str, output: &Output) -> Error {
    let detail = if output.stderr.trim().is_empty() {
        output.stdout.trim()
    } else {
        output.stderr.trim()
    };
    Error::Message(format!("Could not {action} ({}): {detail}", output.status))
}

pub(super) fn quickshell() -> Result<PathBuf> {
    for name in ["qs", "quickshell"] {
        for directory in env::split_paths(&env::var_os("PATH").unwrap_or_default()) {
            let candidate = directory.join(name);
            if candidate.is_file()
                && fs::metadata(&candidate)
                    .is_ok_and(|metadata| metadata.permissions().mode() & 0o111 != 0)
            {
                return Ok(candidate);
            }
        }
    }
    Err(Error::Message(
        "Quickshell is not installed or is missing from PATH".into(),
    ))
}
