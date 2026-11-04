# Menu

`luna menu` opens the menu. `show`, `system`, and `toggle` start it when needed; `start`
prepares a hidden instance. `hide`, `stop`, and `status` control that menu only.
Super+Space toggles it; Super+Esc opens System directly (`luna menu system`).

The default renderer is `$LUNA_CONFIG_HOME_DIR/menu` (otherwise
`$XDG_CONFIG_HOME/luna/menu`, then `~/.config/luna/menu`). For source testing, use
`luna menu --install-dir /absolute/checkout`. Quickshell must already be installed
when using source QML without `luna install luna-menu`.

## Controls

Apps opens installed applications. Trigger → Toggles contains Stay awake.
Trigger → Screenshot offers Select Region, Active Screen, Active Window, and All Screens.
Each dismisses the menu before running `luna screenshot region|screen|window|all`.
Screenshot failures are logged, like Screensaver and Lock startup failures.
System lists Screensaver, Lock,
Suspend, Hibernate, Logout, Reboot, and Shutdown; Suspend and Hibernate are placeholders. About
opens the same terminal as Super+Shift+F (requires Fastfetch). Other main sections remain
placeholders. Hidden and NoDisplay desktop entries are excluded.

Typing at the root searches all nested menu entries and applications. Each submenu
searches its descendants; Apps searches applications. Nested results show their
menu path, which can also be searched (for example, `system lock`).
A nonempty query always adds Search in browser last
(DuckDuckGo in the default browser). A web URL or domain offers Open in browser
first. `!command` offers Run in terminal first, using the default terminal and
`$SHELL` (otherwise `/bin/sh`). Terminal output stays until a silent keypress.
Typing alone never executes an action; press Enter or click its row.

Reboot and Shutdown fade to black with a five-second countdown. Esc or Cancel
returns to System before execution; hiding or reopening also cancels a pending
countdown. Logout runs immediately. Native authorization and inhibitors apply.
Failed requests display an error; Esc returns to System. Screensaver and Lock dismiss
the menu immediately and run `~/.local/bin/luna screensaver` or `~/.local/bin/luna lock`,
without a countdown. Install `luna-screensaver` or `luna-lock` to use them;
startup failures are logged.

Stay awake toggles automatic idle inhibition and shows On or Off. It stays active
when the menu closes, preventing Luna's automatic screensaver and locking. Manual
Screensaver and Lock still work; display power saving while locked is unchanged.
It starts off and resets when the menu process stops or the session ends.
The compositor must support `idle-inhibit-unstable-v1`.
`luna toggle stay-awake [on|off|toggle|status]` controls the same state (default: toggle);
on/toggle start a hidden menu when needed. Status/off leave a stopped menu stopped.
Use `--install-dir PATH` to select source QML.

The running menu also serves `org.freedesktop.ScreenSaver` on the session bus,
translating application D-Bus idle-inhibit requests into Wayland inhibitors.
Both `/ScreenSaver` and `/org/freedesktop/ScreenSaver` share the same requests.
Requests remain active until their owner releases them or disconnects. They are
separate from the manual Stay awake toggle, so switching it off cannot release
a video's request. Keep `luna menu start` running for this bridge; a full Luna
session starts it automatically. Another D-Bus provider is never replaced.

Up/Down and Tab/Shift+Tab select results. Home/End jump to either end; Page Up/Down
move a visible page. Enter or click opens an entry. Escape, Alt+Left, or Backspace
in an empty submenu search returns to the previously visited menu. A directly
opened submenu, including System via Super+Esc, dismisses instead. Escape at the
root dismisses, or clears a nonempty search first.
The clear button resets the query. Any mouse button outside dismisses the menu,
including on other monitors. Opening resets the search on the focused monitor.

Graphical apps use their desktop entry's default action. Terminal apps use
`xdg-terminal-exec`, preserving parsed arguments and working directories.

## Appearance and installation

The main menu and Apps presentation are ported from
[`dot-luna/luna` at 9aa7d7e](https://github.com/dot-luna/luna/tree/9aa7d7e7aa48686d243bc1793f37ee9fd246ab58/src/launcher).
The menu has a compact search header; the row spacing, selection, and font scaling
follow that menu. UI icons use the free Hugeicons set, documented in
[icons/README.md](src/shell/icons/README.md), with its MIT notice.

`luna install luna-menu` installs Quickshell and `xdg-terminal-exec`, then exports the QML
to Luna's menu configuration directory. Configuration replaces that owned directory without
backups and restarts an already-running menu hidden; a stopped menu stays stopped.
Opening links and searches requires `xdg-utils`, included in a full Luna installation.
Application idle inhibition requires `python-dbus` and `python-gobject`, installed
with `luna-menu`.
No separate systemd service is required. Hyprland starts it hidden at login, and
the shortcut can start it on demand.

The Zsh alias `menu` runs `luna menu`, including subcommands. Reconfigure with
`luna configure luna-menu zsh` and open a new terminal to load it.

The API resolves a theme snapshot at process startup through `LUNA_MENU_THEME`.
The renderer never reads or watches theme files. Stop and start the menu after
changing themes. Missing or malformed theme input fails startup.

The card uses `appearance.opacity.active` and requests background blur only when
`appearance.blur.enabled` is true. Blur follows the card's bounds and rounding;
outside click areas stay clear. The compositor must support `ext-background-effect-v1`.
Hyprland's global blur switch still applies. It reads blur settings from the theme
on startup/reload; run `hyprctl reload` after changing them, including `size` and
`passes`. It also exports the user QML import path globally through `QML_IMPORT_PATH`.

## API and checks

`Luna.menu` provides `start`, `show`, `system`, `hide`, `toggle`, `stop`, and `status`.
Options are `repository` for explicit source QML and `env` to replace the process
environment. Responses contain `{running, shellDirectory}`. Missing QML returns
`INVALID_PATH`; unavailable Quickshell or failed native commands return
`COMMAND_FAILED`.

`Luna.menu.stayAwake(action?, options?)` returns `{enabled}`; action is `on`, `off`,
`toggle` (default), or `status`. Invalid actions return `INVALID_ARGUMENT`.

```sh
/usr/lib/qt6/bin/qmllint src/luna-menu/src/shell/*.qml
python3 -m unittest discover -s src/luna-menu/tests -v
bun test packages/luna-api/tests/menu.test.ts __tests__/apps/luna-menu __tests__/apps/hypr-environment.test.ts __tests__/apps/hypr-menu-bindings.test.ts __tests__/apps/shortcuts.test.ts
```

QML tests require Quickshell, `dbus-run-session`, `python-dbus`, and `python-gobject`.
They use private XDG paths,
fake application/session executables, and real Qt keyboard/mouse events. No test
logs out, reboots, or shuts down the host. Offscreen tests
retain production content but replace compositor-specific windows. Focused-monitor
placement, compositor blur, and layer keyboard focus need a Wayland session.
