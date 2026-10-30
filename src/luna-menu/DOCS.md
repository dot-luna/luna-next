# Menu

`lnxt menu start` starts the menu hidden. `lnxt menu show` opens it on the focused
Hyprland monitor and resets its view; `hide` dismisses it and `toggle` switches its
visibility. Hidden menus do not request keyboard focus.

## Applications

The root contains Apps. Enter or click it to list installed applications, or type
at the root to search applications directly. Search matches words in names,
generic names, descriptions, desktop IDs, and keywords. Name matches rank first,
then results sort alphabetically. Hidden and NoDisplay entries are excluded by
Quickshell's native desktop-entry model.

Up/Down and Tab/Shift+Tab move selection; Enter launches it. Escape, Alt+Left, the
back button, or Backspace in an empty Apps search return to the root. Escape at
the root and clicks outside the menu dismiss it, including on other monitors.

Graphical applications use their desktop entry's default action. Terminal
applications use `xdg-terminal-exec`; argument boundaries and the desktop entry's
working directory are retained.

## Themes and validation

The shared menu lifecycle resolves Luna Next's selected theme once at startup and
passes colors, UI font, and appearance in `LUNA_NEXT_MENU_THEME`. Restart the menu
after theme changes. The renderer does not read theme files or watch configuration.

IPC target `menu` exposes `status`, `show`, `hide`, and `toggle`; `status` returns
`running` after the UI loads. Direct Quickshell calls need `call -- menu show`
so its CLI treats `show` as the method name. `LUNA_NEXT_MENU_VALIDATE=1` loads the same UI hidden,
prints `Luna Next menu validation passed`, and exits. Missing or malformed theme
input exits with an error.

## Checks

From the repository root:

```sh
/usr/lib/qt6/bin/qmllint src/luna-menu/src/shell/*.qml
python3 -m unittest discover -s src/luna-menu/tests -v
```

Tests require Quickshell and `dbus-run-session`. They use private XDG directories,
fake desktop executables, and actual Qt keyboard/mouse events. Offscreen tests
replace compositor-specific windows with floating windows while retaining the
production content and behavior. Monitor placement and layer keyboard focus need
a Wayland session.
