use std::{
    env,
    os::unix::process::CommandExt,
    process::Command,
    thread,
    time::{Duration, Instant},
};

use super::{Polkit, Status, UNIT};
use crate::{Error, Result, config_io, io_error, process, theme::Themes};

const COMMAND_TIMEOUT: Duration = Duration::from_secs(5);
const START_TIMEOUT: Duration = Duration::from_secs(12);
const VALIDATION_MARKER: &str = "Luna Next polkit validation passed";
const PATH_ENVIRONMENT: &[&str] = &[
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
    "XDG_CACHE_HOME",
    "LUNA_NEXT_POLKIT_SHELL",
];
const SESSION_ENVIRONMENT: &[&str] = &[
    "DISPLAY",
    "WAYLAND_DISPLAY",
    "XDG_CURRENT_DESKTOP",
    "XDG_SESSION_TYPE",
    "XDG_SESSION_ID",
    "XDG_SESSION_DESKTOP",
    "XDG_SEAT",
    "XDG_VTNR",
    "HYPRLAND_INSTANCE_SIGNATURE",
    "QML_IMPORT_PATH",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
    "XDG_CACHE_HOME",
    "PATH",
    "LUNA_NEXT_POLKIT_SHELL",
];

impl Polkit {
    /// Inspect registration without starting a service or handling credentials.
    pub fn status(&self) -> Result<Status> {
        match self.ipc_status(Duration::from_secs(3))? {
            Some(status) => Ok(status),
            None if self.active(COMMAND_TIMEOUT)? => Ok(Status::Unavailable),
            None => Ok(Status::Stopped),
        }
    }

    /// Validate QML and theme without registering an agent or touching services.
    /// Requires a Wayland session. Validation must exit successfully within ten seconds.
    pub fn validate(&self) -> Result<()> {
        let mut command = self.shell_command()?;
        command.env("LUNA_NEXT_POLKIT_VALIDATE", "1");
        let output = process::run(&mut command, Duration::from_secs(10))?;
        let validated =
            output.stdout.contains(VALIDATION_MARKER) || output.stderr.contains(VALIDATION_MARKER);
        process::checked("validate Luna Next polkit", output)?;
        if !validated {
            return Err(Error::Message(
                "Luna Next polkit validation failed: no completion marker; check its QML imports"
                    .into(),
            ));
        }
        Ok(())
    }

    /// Reuse a registered service, or validate, enable login startup, and start it.
    /// Failed validation leaves running agents untouched. A failed new start is stopped.
    pub fn start(&self) -> Result<Status> {
        self.activate(false)
    }

    /// Validate before replacing this service, then wait for native registration.
    pub fn restart(&self) -> Result<Status> {
        self.activate(true)
    }

    /// Stop this service for the current session, leaving login startup enabled.
    pub fn stop(&self) -> Result<Status> {
        let _lock = config_io::lock(&self.paths.service_file)?;
        systemctl(&["stop", UNIT])?;
        Ok(Status::Stopped)
    }

    /// Run Quickshell in the foreground for the user service, with the resolved
    /// Luna theme supplied once. On Unix, success replaces the calling process.
    pub fn serve(&self) -> Result<()> {
        let mut command = self.shell_command()?;
        command.env_remove("LUNA_NEXT_POLKIT_VALIDATE");
        Err(io_error(
            "launch Luna Next polkit",
            &self.paths.shell_path,
            command.exec(),
        ))
    }

    fn activate(&self, restart: bool) -> Result<Status> {
        let _lock = config_io::lock(&self.paths.service_file)?;
        if !self.paths.service_file.is_file() {
            return Err(Error::Message(format!(
                "Polkit user service not found: {}; run luna configure luna-polkit",
                self.paths.service_file.display()
            )));
        }
        if !restart && self.ipc_status(Duration::from_secs(3))? == Some(Status::Running) {
            // Enabling changes only login startup; a pending prompt keeps its process.
            systemctl(&["enable", UNIT])?;
            return Ok(Status::Running);
        }
        self.validate()?;
        // Validation and the service must resolve the same config/runtime paths.
        // Keep compositor/session values managed by the graphical login intact.
        let mut unset = vec!["unset-environment"];
        unset.extend(
            PATH_ENVIRONMENT
                .iter()
                .copied()
                .filter(|key| env::var_os(key).is_none_or(|value| value.is_empty())),
        );
        if unset.len() > 1 {
            systemctl(&unset)?;
        }
        let mut import = vec!["import-environment"];
        import.extend(SESSION_ENVIRONMENT.iter().copied().filter(|key| {
            env::var_os(key)
                .is_some_and(|value| !PATH_ENVIRONMENT.contains(key) || !value.is_empty())
        }));
        if import.len() > 1 {
            systemctl(&import)?;
        }
        systemctl(&["daemon-reload"])?;
        systemctl(&["enable", UNIT])?;
        let result = systemctl(&[if restart { "restart" } else { "start" }, UNIT])
            .and_then(|()| self.wait_registered());
        if let Err(error) = result {
            return match systemctl(&["stop", UNIT]) {
                Ok(()) => Err(error),
                Err(cleanup) => Err(Error::Message(format!(
                    "{error}; failed to stop the unsuccessful agent: {cleanup}"
                ))),
            };
        }
        Ok(Status::Running)
    }

    fn wait_registered(&self) -> Result<()> {
        let deadline = Instant::now() + START_TIMEOUT;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(Error::Message(format!(
                    "Luna Next polkit did not register within twelve seconds; check journalctl --user -u {UNIT}"
                )));
            }
            if self.ipc_status(remaining.min(Duration::from_secs(1)))? == Some(Status::Running) {
                return Ok(());
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                continue;
            }
            if !self.active(remaining.min(Duration::from_secs(1)))? {
                return Err(Error::Message(format!(
                    "Luna Next polkit exited before registering; check journalctl --user -u {UNIT}"
                )));
            }
            thread::sleep(
                Duration::from_millis(100).min(deadline.saturating_duration_since(Instant::now())),
            );
        }
    }

    fn ipc_status(&self, timeout: Duration) -> Result<Option<Status>> {
        let output = process::run(
            Command::new(process::quickshell()?)
                .args(["ipc", "-p"])
                .arg(&self.paths.shell_path)
                .args(["call", "polkit", "status"]),
            timeout,
        )?;
        if !output.status.success() {
            return Ok(None);
        }
        match output.stdout.trim() {
            "running" => Ok(Some(Status::Running)),
            "unavailable" => Ok(Some(Status::Unavailable)),
            value => Err(Error::Message(format!(
                "Invalid Luna Next polkit status: {value:?}"
            ))),
        }
    }

    fn active(&self, timeout: Duration) -> Result<bool> {
        let output = process::run(
            Command::new("systemctl").args(["--user", "is-active", "--quiet", UNIT]),
            timeout,
        )?;
        if output.status.success() {
            Ok(true)
        } else if matches!(output.status.code(), Some(3 | 4)) {
            Ok(false)
        } else {
            process::checked("inspect Luna Next polkit service", output).map(|()| false)
        }
    }

    fn shell_command(&self) -> Result<Command> {
        if env::var_os("WAYLAND_DISPLAY").is_none_or(|value| value.is_empty()) {
            return Err(Error::Message(
                "Luna Next polkit requires a Wayland session".into(),
            ));
        }
        if !self.paths.shell_path.is_file() {
            return Err(Error::Message(format!(
                "Polkit shell not found: {}",
                self.paths.shell_path.display()
            )));
        }
        let mut command = Command::new(process::quickshell()?);
        let theme = Themes::from_env()?.get(None)?;
        // Wallpapers and other theme metadata are unrelated to authentication;
        // keep this one-shot environment value independent of the wallpaper list size.
        let appearance = serde_json::json!({
            "colors": theme["colors"],
            "fonts": theme["fonts"],
            "appearance": theme["appearance"],
        });
        command.arg("-p").arg(&self.paths.shell_path).env(
            "LUNA_NEXT_POLKIT_THEME",
            serde_json::to_string(&appearance)?,
        );
        Ok(command)
    }
}

fn systemctl(arguments: &[&str]) -> Result<()> {
    let output = process::run(
        Command::new("systemctl").arg("--user").args(arguments),
        COMMAND_TIMEOUT,
    )?;
    process::checked("manage Luna Next polkit service", output)
}
