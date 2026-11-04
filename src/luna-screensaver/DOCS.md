# Luna Screensaver

## Dependencies

Hyprland, Quickshell, and Qt 6 Quick/QML/Wayland are required. Quickshell needs
the `Quickshell.Io`, `Quickshell.Wayland`, and `Quickshell.Hyprland` modules and
the compositor's idle notification protocol. `luna install luna-screensaver`
installs the app dependencies.

## Configuration

The [Luna API](../../packages/luna-api/DOCS.md) parses JSONC and validates settings.
JSON is accepted too. The path is `--config <path>`, then nonempty
`LUNA_SCREENSAVER_CONFIG`, otherwise `$LUNA_CONFIG_HOME_DIR/screensaver.jsonc`,
`$XDG_CONFIG_HOME/luna/screensaver.jsonc`, or `~/.config/luna/screensaver.jsonc`.
Relative paths use the working directory. Missing files and parent directories
are created automatically; omitted settings use defaults in memory.

[`idle_seconds`](example.jsonc) accepts an integer from 0 to 86400, defaults to
300, and disables automatic display at 0. Idle inhibitors are respected. Locking
and display power belong to the separate lock service.
The running [menu](../luna-menu/DOCS.md) bridges application D-Bus requests into
Wayland idle inhibition; keep it running for video apps that use D-Bus.

```sh
luna screensaver show
luna screensaver hide
luna screensaver set-idle 600
luna screensaver get idle_seconds
luna screensaver reload
luna screensaver status
luna screensaver stop
```

`open` aliases `show`. `get` without a key returns source settings; missing keys
return `null`. Mutations save atomically and apply to the running renderer. A
failed application restores the previous source when no external edit would be
overwritten. `reload` applies direct file edits; `restart` replaces the process.
For a source checkout, add `--install-dir /absolute/path/to/luna-next` to renderer
commands and mutations and use the same checkout for subsequent commands.

The renderer reads no configuration files and watches no source files. The API
checks Hyprland's lock state before showing it. All monitors display the clock;
the focused monitor receives keyboard input. Any key, click, or wheel input
dismisses immediately. Pointer movement dismisses after a 300 ms startup guard.

## Tests

From the repository root:

```sh
python3 -m unittest discover -s src/luna-screensaver/tests -v
/usr/lib/qt6/bin/qmllint --uncreatable-type disable src/luna-screensaver/src/shell/*.qml
```

Tests need Python 3, Quickshell, and Qt Test. They exercise the production QML in
an isolated offscreen renderer, replacing only layer-shell placement and the
native idle event source. They do not verify live compositor placement or its
idle inhibitor handling.
