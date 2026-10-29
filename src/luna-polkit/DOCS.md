# Luna Next polkit agent

Requires Quickshell 0.3.2+ with `Quickshell.Services.Polkit`, Qt Quick Controls,
polkit, a Wayland session, and a systemd user manager. Runtime packages are in
[the main package list](../../installs/packages.conf).

Install the CLI and app with `lnxt install --local cli polkit`, then run
`lnxt polkit start` from the desktop session. Other authentication agents must
release the session registration first.

| Command | Behavior |
| --- | --- |
| `lnxt polkit start` | Validate the real UI, enable session autostart, start and confirm registration. A healthy instance is kept. |
| `lnxt polkit restart` | Validate before replacing the running instance. |
| `lnxt polkit stop` | Stop the agent; login startup remains enabled. |
| `lnxt polkit status` | Print `running`, `unavailable`, or `stopped`. |
| `lnxt polkit serve` | Foreground process used by the user service. |

The app links into `$XDG_DATA_HOME/luna-next/polkit` (default `~/.local/share`).
[app.conf](../../apps/luna-polkit/app.conf) installs the systemd unit under
`$XDG_CONFIG_HOME/systemd/user`. The service follows `graphical-session.target`,
restarts after crashes, and imports the session environment when started.
The supplied Hyprland configuration starts it at login. No root daemon is added.

Colors, fonts, borders, and rounding come from the shared theme API once at
startup. Restart after changing the theme. There is no separate app config or
file watcher. `LUNA_NEXT_POLKIT_SHELL` can select a different shell path.

Passwords go directly to the native authentication conversation, with no files,
logs, shell commands, or IPC carrying responses. Inputs and undo history clear
between challenges, requests, and identity changes. Escape cancels; Enter submits;
Tab navigates the account selector and buttons. Polkit and PAM retain their policies.

```sh
python3 -m unittest discover -s src/luna-polkit/tests -v
cargo test -p luna-next --test polkit
cargo test -p ln-cli
```

QML tests use fake conversations and an isolated D-Bus authority. They never
authenticate against the host. Native backend tests also need Python GObject
bindings (`python-gobject`). For live troubleshooting, use
`journalctl --user -u luna-next-polkit.service`.
