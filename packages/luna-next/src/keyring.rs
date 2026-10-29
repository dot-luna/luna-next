use std::process::{Command, Stdio};

use crate::{Error, Result};

/// Enable GNOME Keyring's vendor socket for this user and start listening now.
/// Requires the `gnome-keyring` package and a running systemd user manager.
/// Repeated calls leave the active daemon and its unlocked collections intact.
/// Login unlocking belongs to the display manager's PAM configuration; this
/// operation does not handle passwords, change PAM, or unlock a locked keyring.
pub fn setup() -> Result<()> {
    const SOCKET: &str = "gnome-keyring-daemon.socket";
    let status = Command::new("systemctl")
        .args(["--user", "enable", "--now", SOCKET])
        .stdin(Stdio::null())
        // Reserve stdout for callers such as the CLI's JSON response.
        .stdout(Stdio::from(std::io::stderr()))
        .stderr(Stdio::inherit())
        .status()
        .map_err(|error| {
            Error::Message(format!(
                "Cannot enable GNOME Keyring socket '{SOCKET}': cannot run systemctl: {error}"
            ))
        })?;
    if !status.success() {
        return Err(Error::Message(format!(
            "Cannot enable GNOME Keyring socket '{SOCKET}': systemctl failed ({status})"
        )));
    }
    Ok(())
}
