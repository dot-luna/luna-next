# Luna Polkit

Requires Quickshell 0.3.2+ with `Quickshell.Services.Polkit`, Qt Quick Controls,
polkit, and a Wayland desktop session recognized by logind. `luna install luna-polkit`
installs the declared packages, QML, and [default settings](../../apps/luna-polkit/config/polkit.jsonc).

Luna's Hyprland configuration runs `luna polkit start` at login. Other compositors
can run that command from their session startup. Stop any other authentication
agent first; Luna does not terminate competing agents. After upgrading from KDE's
agent, log out and back in. Remove `polkit-kde-agent` manually once Luna is working. There is no separate systemd service.

| Command                       | Behavior                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| `luna polkit start`           | Validate the UI, start the agent, and confirm registration; keep a healthy instance. |
| `luna polkit restart`         | Validate settings and UI before replacing the running instance.                      |
| `luna polkit stop`            | Stop this agent; login startup remains configured.                                   |
| `luna polkit status`          | Print `running`, `unavailable`, or `stopped`.                                        |
| `luna polkit get [key]`       | Read source settings; absent keys return null.                                       |
| `luna polkit get-config-file` | Print the settings path.                                                             |

Settings use `--config <file>`, then `LUNA_POLKIT_CONFIG`, then
`$LUNA_CONFIG_HOME_DIR/polkit.jsonc` (normally `~/.config/luna/polkit.jsonc`).
Missing settings files are created as `{}`. Defaults merge only in memory:
`width` is 420 pixels (280–640), and `dim_opacity` is 0.5 (0–0.8).
Colors, fonts, borders, and rounding follow the shared theme. Restart after edits;
there are no file watchers. `--install-dir <checkout>` selects source QML instead
of the installed `$LUNA_CONFIG_HOME_DIR/polkit` shell.

Passwords go directly to the native conversation, never through CLI IPC, files,
logs, or shell commands. Input and undo history clear between challenges and
identity changes. Escape cancels, Enter submits, and Tab navigates controls.
Polkit and PAM retain their policies. Restarting cancels a pending prompt.

From the repository root:

```sh
bun run check
bun test packages/luna-api/tests/polkit.test.ts __tests__/apps/luna-polkit __tests__/apps/hypr-startup.test.ts
python3 -m unittest discover -s src/luna-polkit/tests -v
/usr/lib/qt6/bin/qmllint -I /usr/lib/qt6/qml src/luna-polkit/src/shell/*.qml
bun run --cwd src/luna-cli build --no-install
```

Native tests need `python-gobject` and a logind session. They use an isolated
D-Bus authority; UI tests use fake conversations, without authenticating on the host.
