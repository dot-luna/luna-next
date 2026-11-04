# Luna Lock

## Setup

Hyprland and Quickshell with `Quickshell.Wayland`, `Quickshell.Hyprland`,
`Quickshell.Io`, and `Quickshell.Services.Pam` are required. Authentication uses
the system's `/etc/pam.d/login` service for the current user. The compositor must
support Wayland session locking and idle notifications. `luna install luna-lock`
installs the app dependencies.

The installed shell is `~/.config/luna/lock/`. Customize `LockView.qml` to change
the clock and authentication UI. Authentication stays in the native PAM context;
passwords never pass through the CLI or IPC. Source files are not watched.

## Configuration and commands

The [Luna API](../../packages/luna-api/DOCS.md) parses JSONC and validates settings.
The settings path is `--config <path>`, then nonempty `LUNA_LOCK_CONFIG`, otherwise
`$LUNA_CONFIG_HOME_DIR/lock.jsonc`, `$XDG_CONFIG_HOME/luna/lock.jsonc`, or
`~/.config/luna/lock.jsonc`. Relative paths use the working directory. Missing
files and parent directories are created automatically. Omitted settings use
defaults in memory; reads preserve the source.

| Setting | Default | Behavior |
| --- | --- | --- |
| `idle_seconds` | 600 | Automatic lock timeout; 0 disables it. Idle inhibitors are respected. |
| `dpms_seconds` | 30 | Display power-off timeout while securely locked; 0 disables it. Idle inhibitors are ignored. |

Both settings accept integers from 0 to 86400. See [example.jsonc](example.jsonc).
The running [menu](../luna-menu/DOCS.md) bridges application D-Bus requests into
Wayland idle inhibition. These prevent automatic locking, while manual locking
and display power-off after a secure lock still work.

```sh
luna lock
luna lock start
luna lock status
luna lock set-idle 600
luna lock set-dpms 30
luna lock get dpms_seconds
luna lock reload
```

`start` runs the service without locking immediately. Manual locking waits for
the compositor to confirm a secure session lock. Activity wakes sleeping displays
and keeps the session locked. Only successful PAM authentication unlocks it.
Enter submits the current response; Escape clears it. The Unlock button and Tab
navigation support mouse and keyboard use. All monitors receive lock surfaces.

`get` without a key returns source settings; missing keys return `null`. Mutations
save atomically and apply to the running service. Failed application restores the
previous source when no external edit would be overwritten. `reload` applies
settings and theme snapshots without releasing an active lock. `stop` and
`restart` refuse while a lock is requested or secure. The service exposes no
unlock command. Never terminate its process while locked: the compositor can
keep the session locked after the client exits.

For a source checkout, add `--install-dir /absolute/path/to/luna-next` to renderer
commands and mutations and use the same checkout for subsequent commands.

## Tests

From the repository root:

```sh
python3 -m unittest discover -s src/luna-lock/tests -v
/usr/lib/qt6/bin/qmllint --uncreatable-type disable src/luna-lock/src/shell/*.qml
```

Tests need Python 3, Quickshell, and Qt Test. They exercise production QML in a
private offscreen process, replacing native compositor events, lock acquisition,
and PAM responses. Native types also compile and start idle without acquiring a
lock. These checks do not authenticate a real account, lock the live desktop,
or verify compositor security, multi-monitor placement, and hardware power state.
