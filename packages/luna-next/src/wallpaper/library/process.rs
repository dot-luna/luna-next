use super::message;
use crate::{Result, io_error};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tempfile::NamedTempFile;

pub(super) fn run(command: &mut Command, timeout: Duration) -> Result<String> {
    let program = PathBuf::from(command.get_program());
    let output =
        NamedTempFile::new().map_err(|error| io_error("capture media command", &program, error))?;
    let errors =
        NamedTempFile::new().map_err(|error| io_error("capture media command", &program, error))?;
    let mut child = command
        .stdin(Stdio::null())
        .stdout(
            output
                .reopen()
                .map_err(|error| io_error("capture media command", &program, error))?,
        )
        .stderr(
            errors
                .reopen()
                .map_err(|error| io_error("capture media command", &program, error))?,
        )
        .spawn()
        .map_err(|error| io_error("run media command (is it installed?)", &program, error))?;
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < timeout => {
                std::thread::sleep(Duration::from_millis(20))
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(message(format!(
                    "Media command timed out: {}",
                    program.display()
                )));
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(io_error("wait for media command", &program, error));
            }
        }
    };
    let read_output = |path: &Path| -> Result<String> {
        let mut text = String::new();
        File::open(path)
            .and_then(|file| file.take(64 * 1024).read_to_string(&mut text))
            .map_err(|error| io_error("read media command output", path, error))?;
        Ok(text)
    };
    if !status.success() {
        return Err(message(format!(
            "{} failed: {}",
            program.display(),
            read_output(errors.path())?.trim()
        )));
    }
    read_output(output.path())
}
