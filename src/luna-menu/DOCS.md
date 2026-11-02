# Menu

`luna menu` opens the menu. `show` and `toggle` start it when needed; `start`
prepares a hidden instance. `hide`, `stop`, and `status` control that menu only.
Super+Space toggles it through Luna's Hyprland bindings.

The default renderer is `$LUNA_CONFIG_HOME_DIR/menu` (otherwise
`$XDG_CONFIG_HOME/luna/menu`, then `~/.config/luna/menu`). For source testing, use
`luna menu --install-dir /absolute/checkout`. Quickshell must already be installed
when using source QML without `luna install luna-menu`.

## Controls

Apps opens installed applications. Other main sections remain placeholders.
Typing at the root searches sections and applications; searching inside Apps is
scoped to applications. Hidden and NoDisplay desktop entries are excluded.

Up/Down and Tab/Shift+Tab select results. Home/End jump to either end; Page Up/Down
move a visible page. Enter or click opens an entry. Escape, Alt+Left, or Backspace
in an empty Apps search returns to the root; Escape at the root dismisses.
The clear button resets the query. Any mouse button outside dismisses the menu,
including on other monitors. Opening resets the search on the focused monitor.

Graphical apps use their desktop entry's default action. Terminal apps use
`xdg-terminal-exec`, preserving parsed arguments and working directories.

## Appearance and installation

The main menu and Apps presentation are ported from
[`dot-luna/luna` at 9aa7d7e](https://github.com/dot-luna/luna/tree/9aa7d7e7aa48686d243bc1793f37ee9fd246ab58/src/launcher).
The header, fixed-height body, row spacing, selection, and font scaling follow
that menu. UI icons use the free Hugeicons set, documented in
[icons/README.md](src/shell/icons/README.md), with its MIT notice.

`luna install luna-menu` installs Quickshell and `xdg-terminal-exec`, then exports the QML
to Luna's menu configuration directory. Configuration replaces that owned directory without
backups and restarts an already-running menu hidden; a stopped menu stays stopped.
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
Hyprland reads blur `size` and `passes` from the theme on startup/reload; run
`hyprctl reload` after changing those values. It also exports the user QML import
path globally through `QML_IMPORT_PATH`.

## API and checks

`Luna.menu` provides `start`, `show`, `hide`, `toggle`, `stop`, and `status`.
Options are `repository` for explicit source QML and `env` to replace the process
environment. Responses contain `{running, shellDirectory}`. Missing QML returns
`INVALID_PATH`; unavailable Quickshell or failed native commands return
`COMMAND_FAILED`.

```sh
/usr/lib/qt6/bin/qmllint src/luna-menu/src/shell/*.qml
python3 -m unittest discover -s src/luna-menu/tests -v
bun test packages/luna-api/tests/menu.test.ts __tests__/apps/luna-menu __tests__/apps/hypr-environment.test.ts
```

QML tests require Quickshell and `dbus-run-session`. They use private XDG paths,
fake application executables, and real Qt keyboard/mouse events. Offscreen tests
retain production content but replace compositor-specific windows. Focused-monitor
placement, compositor blur, and layer keyboard focus need a Wayland session.
