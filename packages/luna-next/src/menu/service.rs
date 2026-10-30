use std::{
    env,
    os::unix::process::CommandExt,
    process::Command,
    thread,
    time::{Duration, Instant},
};

use super::{Menu, Status, UNIT};
use crate::{Error, Result, config_io, io_error, process, theme::Themes};

const COMMAND_TIMEOUT: Duration = Duration::from_secs(5);
const START_TIMEOUT: Duration = Duration::from_secs(12);
const VALIDATION_MARKER: &str = "Luna Next menu validation passed";
const PATH_ENVIRONMENT: &[&str] = &[
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
    "XDG_CACHE_HOME",
    "LUNA_NEXT_MENU_SHELL",
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
    "LUNA_NEXT_MENU_SHELL",
];

impl Menu {
    /// Inspect IPC readiness without changing the service or launcher visibility.
    pub fn status(&self) -> Result<Status> {
        Ok(if self.ready(Duration::from_secs(3))? {
            Status::Running
        } else {
            Status::Stopped
        })
    }

    /// Validate QML and the selected theme without starting the service.
    /// Requires a Wayland session and successful completion within ten seconds.
    pub fn validate(&self) -> Result<()> {
        let mut command = self.shell_command()?;
        command.env("LUNA_NEXT_MENU_VALIDATE", "1");
        let output = process::run(&mut command, Duration::from_secs(10))?;
        let validated =
            output.stdout.contains(VALIDATION_MARKER) || output.stderr.contains(VALIDATION_MARKER);
        process::checked("validate Luna Next menu", output)?;
        if !validated {
            return Err(Error::Message(
                "Luna Next menu validation failed: no completion marker; check its QML imports"
                    .into(),
            ));
        }
        Ok(())
    }

    /// Start hidden and enable login startup, preserving an existing ready menu.
    /// New services are validated first; failed new starts are stopped.
    pub fn start(&self) -> Result<Status> {
        self.activate(false)
    }

    /// Validate before replacing the service; the new launcher starts hidden.
    pub fn restart(&self) -> Result<Status> {
        self.activate(true)
    }

    /// Stop the service for this session, leaving login startup enabled.
    pub fn stop(&self) -> Result<Status> {
        let _lock = config_io::lock(&self.paths.service_file)?;
        systemctl(&["stop", UNIT])?;
        Ok(Status::Stopped)
    }

    /// Start the service if needed and show the launcher.
    pub fn show(&self) -> Result<Status> {
        self.start()?;
        self.visibility("show")
    }

    /// Hide a running launcher; a stopped service remains stopped.
    pub fn hide(&self) -> Result<Status> {
        if self.status()? == Status::Stopped {
            return Ok(Status::Stopped);
        }
        self.visibility("hide")
    }

    /// Start the service if needed, then toggle launcher visibility.
    pub fn toggle(&self) -> Result<Status> {
        self.start()?;
        self.visibility("toggle")
    }

    /// Run the hidden menu in the foreground, supplying the selected theme once.
    /// On Unix, successful launch replaces the calling process.
    pub fn serve(&self) -> Result<()> {
        let mut command = self.shell_command()?;
        command.env_remove("LUNA_NEXT_MENU_VALIDATE");
        Err(io_error(
            "launch Luna Next menu",
            &self.paths.shell_path,
            command.exec(),
        ))
    }

    fn activate(&self, restart: bool) -> Result<Status> {
        let _lock = config_io::lock(&self.paths.service_file)?;
        if !self.paths.service_file.is_file() {
            return Err(Error::Message(format!(
                "Menu user service not found: {}; run luna configure luna-menu",
                self.paths.service_file.display()
            )));
        }
        if !restart && self.ready(Duration::from_secs(3))? {
            systemctl(&["enable", UNIT])?;
            return Ok(Status::Running);
        }
        self.validate()?;
        self.import_environment()?;
        systemctl(&["daemon-reload"])?;
        systemctl(&["enable", UNIT])?;
        let result = systemctl(&[if restart { "restart" } else { "start" }, UNIT])
            .and_then(|()| self.wait_ready());
        if let Err(error) = result {
            return match systemctl(&["stop", UNIT]) {
                Ok(()) => Err(error),
                Err(cleanup) => Err(Error::Message(format!(
                    "{error}; failed to stop the unsuccessful menu: {cleanup}"
                ))),
            };
        }
        Ok(Status::Running)
    }

    fn import_environment(&self) -> Result<()> {
        // Remove stale path overrides when the caller returns to the default homes.
        // Session identity remains managed by the graphical login.
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
            let mut command = Command::new("systemctl");
            command.arg("--user").args(&import);
            // The user manager has a different working directory from the CLI.
            // Import the resolved path for a relative shell override.
            if import.contains(&"LUNA_NEXT_MENU_SHELL") {
                command.env("LUNA_NEXT_MENU_SHELL", &self.paths.shell_path);
            }
            process::checked(
                "import Luna Next menu environment",
                process::run(&mut command, COMMAND_TIMEOUT)?,
            )?;
        }
        Ok(())
    }

    fn wait_ready(&self) -> Result<()> {
        let deadline = Instant::now() + START_TIMEOUT;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(Error::Message(format!(
                    "Luna Next menu did not become ready within twelve seconds; check journalctl --user -u {UNIT}"
                )));
            }
            if self.ready(remaining.min(Duration::from_secs(1)))? {
                return Ok(());
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                continue;
            }
            let output = process::run(
                Command::new("systemctl").args(["--user", "is-active", "--quiet", UNIT]),
                remaining.min(Duration::from_secs(1)),
            )?;
            if !output.status.success() {
                if !matches!(output.status.code(), Some(3 | 4)) {
                    process::checked("inspect Luna Next menu service", output)?;
                }
                return Err(Error::Message(format!(
                    "Luna Next menu exited before becoming ready; check journalctl --user -u {UNIT}"
                )));
            }
            thread::sleep(
                Duration::from_millis(100).min(deadline.saturating_duration_since(Instant::now())),
            );
        }
    }

    fn ready(&self, timeout: Duration) -> Result<bool> {
        let output = process::run(&mut self.ipc_command("status")?, timeout)?;
        if !output.status.success() {
            return Ok(false);
        }
        if output.stdout.trim() != "running" {
            return Err(Error::Message(format!(
                "Invalid Luna Next menu status: {:?}",
                output.stdout.trim()
            )));
        }
        Ok(true)
    }

    fn visibility(&self, method: &str) -> Result<Status> {
        let output = process::run(&mut self.ipc_command(method)?, COMMAND_TIMEOUT)?;
        process::checked("change Luna Next menu visibility", output)?;
        Ok(Status::Running)
    }

    fn ipc_command(&self, method: &str) -> Result<Command> {
        let mut command = Command::new(process::quickshell()?);
        command
            .args(["ipc", "-p"])
            .arg(&self.paths.shell_path)
            // Otherwise `show` is parsed as Quickshell's IPC introspection command.
            .args(["call", "--", "menu", method]);
        Ok(command)
    }

    fn shell_command(&self) -> Result<Command> {
        if env::var_os("WAYLAND_DISPLAY").is_none_or(|value| value.is_empty()) {
            return Err(Error::Message(
                "Luna Next menu requires a Wayland session".into(),
            ));
        }
        if !self.paths.shell_path.is_file() {
            return Err(Error::Message(format!(
                "Menu shell not found: {}",
                self.paths.shell_path.display()
            )));
        }
        let mut command = Command::new(process::quickshell()?);
        let theme = Themes::from_env()?.get(None)?;
        // Only appearance is needed by the launcher; wallpaper metadata can be large.
        let appearance = serde_json::json!({
            "colors": theme["colors"],
            "fonts": theme["fonts"],
            "appearance": theme["appearance"],
        });
        command
            .arg("-p")
            .arg(&self.paths.shell_path)
            .env("LUNA_NEXT_MENU_THEME", serde_json::to_string(&appearance)?);
        Ok(command)
    }
}

fn systemctl(arguments: &[&str]) -> Result<()> {
    let output = process::run(
        Command::new("systemctl").arg("--user").args(arguments),
        COMMAND_TIMEOUT,
    )?;
    process::checked("manage Luna Next menu service", output)
}
