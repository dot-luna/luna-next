# Luna Bar

`luna bar` starts the bar. `start` reuses a running instance; `stop`, `restart`,
`status`, and `focus` control only this app. Hyprland starts it at login.
`luna install luna-bar` installs Quickshell and exports the renderer.
Configuring replaces the owned QML directory and restarts a running bar;
a stopped bar stays stopped.

The bar appears on every screen and reserves space above tiled windows. Its
left side follows the [old Luna bar](https://github.com/dot-luna/luna/blob/9aa7d7e7aa48686d243bc1793f37ee9fd246ab58/src/luna-bar/Bar.qml):
four baseline workspaces, plus existing higher numbered workspaces. Scratchpads
are excluded. The current workspace is a number (`0` for workspace 10); other
workspaces are dots. Click one to switch. There are no other widgets.

Super+B focuses the bar on the focused monitor. Left/Right or Tab/Shift+Tab
select a workspace; Enter/Space activates it and Escape returns to the app.
The existing Super+1–9/0 shortcuts switch directly. Normal bar startup does not
take keyboard focus. Workspace numbers are shared across monitors.

Theme colors, font, opacity, rounding, border, and outer gaps are read once at
startup. Run `luna bar restart` after changing themes. No configuration watchers
are used. The renderer defaults to `$LUNA_CONFIG_HOME_DIR/bar`, otherwise
`$XDG_CONFIG_HOME/luna/bar` or `~/.config/luna/bar`.
Use `--install-dir /absolute/checkout` for source QML.

`Luna.bar` exposes `start`, `stop`, `restart`, `status`, and `focus`. Each accepts
`{repository?, env?}`; `env` replaces the process environment. Responses contain
`{running, shellDirectory}`. Missing QML returns `INVALID_PATH`; missing Quickshell
or renderer failure returns `COMMAND_FAILED`. Restart resolves the theme before
stopping a working instance.

```sh
bun run check
bun test packages/luna-api/tests/bar.test.ts __tests__/apps/luna-bar __tests__/apps/hypr-startup.test.ts __tests__/apps/hypr-menu-bindings.test.ts
/usr/lib/qt6/bin/qmllint --uncreatable-type disable src/luna-bar/src/shell/*.qml
python3 -m unittest discover -s src/luna-bar/tests -v
bun run --cwd src/luna-cli build --no-install
```

The QML checks use Qt Test and Quickshell with isolated offscreen windows.
Layer placement, reserved space, and compositor keyboard focus need a live
Hyprland session. No Rust build is needed.
