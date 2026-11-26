# Luna Bar

`luna bar` starts the bar. `start` reuses a running instance; `stop`, `restart`,
`status`, `focus`, and `toggle` control only this app. Hyprland starts it at login.
`luna install luna-bar` installs Quickshell and exports the renderer and `bar.jsonc`.
Configuring replaces the owned QML directory and settings file, and restarts a
running bar; a stopped bar stays stopped.

The bar appears on every screen and reserves space above tiled windows. Hiding releases its reserved space immediately. It also hides
while the screen's workspace shows a fullscreen window.

- **Workspaces (left):** four baseline workspaces, plus existing higher numbered
  ones; scratchpads are excluded. Other workspaces are dots. The active one shows
  its configured icon, or its number (`0` for workspace 10). Only
  `workspaces.visible` slots show at once; the strip scrolls to keep the active or
  focused workspace in view, and the mouse wheel scrolls it. Click one to switch.
- **Clock (centre):** the date and time. Click it to open the calendar with your
  local time and any world clocks beside it. Click outside or press Escape to close.
- **Calendar:** switch between AD and BS (Bikram Sambat). Each day also shows the
  other calendar's date, small. Click the month title to return to today. BS dates
  cover BS 2000–2089 (1943-04-14 to 2033-04-13 AD); outside that range the
  calendar shows AD only.

## Quick controls and tray

Click the status icons on the right for volume, microphone and brightness sliders.
Click an audio icon to mute; its chevron opens device selection and per-app volumes.
Selecting a device changes the default and moves existing app streams. The panel
shows apps actively using the microphone. Brightness is hidden without a backlight.

The network tile shows **Wired · Connected** when Ethernet is connected, otherwise
Wi-Fi status. Wired is display-only. The Wi-Fi tile toggles Wi-Fi, and the chevron
always opens networks. Select a network to connect or disconnect; new WPA personal
networks ask for a password. Set up enterprise networks in NetworkManager first.

Bluetooth toggles separately from its device page. Paired devices connect in the
panel; selecting a new device opens Blueman for pairing and PIN prompts. Discovery
stops when the page closes. Dark mode changes the desktop light/dark preference;
Stay awake uses Luna Menu's idle inhibitor. Media controls appear for playing or
paused players. Lock and power use Luna's existing actions and system menu.

The small dropdown beside the status icons lists tray apps. Click an app to open
it, or its chevron for the app's menu. Escape or a click outside closes popups.
Sliders and buttons support Tab, arrows and Enter; long lists scroll with focus.

## Keyboard

Super+B focuses the bar on the focused monitor. Left/Right select a workspace,
Tab moves on to the clock and controls, Enter/Space activates, and Escape returns to the app.
In the calendar, Left/Right change month and Tab reaches the AD/BS switch.
Super+Shift+Space shows or hides the bar on every screen; the choice lasts until
the bar restarts. The existing Super+1–9/0 shortcuts switch directly. Normal bar
startup does not take keyboard focus.

## Settings

`$LUNA_CONFIG_HOME_DIR/bar.jsonc` (or `LUNA_BAR_CONFIG`) is read once at start.
Missing files are created as `{}`; defaults merge only in memory. Run
`luna bar restart` after editing it or changing themes. No watchers are used.

| Key                                       | Default                                                                     | Meaning                                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `workspaces.visible`                      | `4`                                                                         | Slots shown at once (1–10).                                                                                                |
| `workspaces.icons`                        | 1 `code-xml`, 2 `terminal`, 3 `chrome`, 8 `video-01`, 9 `chat-01`, 10 `bot` | Active-workspace icons by workspace ID; a bundled name or an absolute `.svg` path. A configured map replaces the defaults. |
| `clock.format`                            | `ddd d MMM  HH:mm`                                                          | Bar clock, in [Qt date format](https://doc.qt.io/qt-6/qml-qtqml-qt.html#formatDateTime-method).                            |
| `clock.time_format` / `clock.date_format` | `HH:mm` / `ddd d MMM`                                                       | Clocks beside the calendar.                                                                                                |
| `clock.world`                             | CST, EST, UTC                                                               | Up to 8 `{name, timezone}` clocks; `timezone` is an IANA name. A configured list replaces the defaults.                    |
| `calendar.default`                        | `ad`                                                                        | Calendar shown first: `ad` or `bs`.                                                                                        |

`controls.sliders` defaults to `["output", "input", "brightness"]` and
`controls.tiles` to `["network", "bluetooth", "dark_mode", "stay_awake"]`.
Each list replaces its defaults, keeps its order and removes duplicates; use `[]`
to hide that group. `controls.media` and `tray.enabled` default to `true`.

Unknown icons or timezones and out-of-range values fail with `INVALID_METADATA`
before a running bar is replaced. Theme colors, font, opacity, rounding, border,
outer gaps, and blur come from the selected theme. Bundled icons are free Hugeicons;
see [icons/README.md](src/shell/icons/README.md).

## API

`Luna.bar` exposes `start`, `stop`, `restart`, `status`, `focus`, `toggle`, `get`,
and `getConfigFile`. Each accepts `{repository?, configFile?, env?}`; `env` replaces
the process environment. Runtime responses contain `{running, shellDirectory,
configFile}`. `toggle` starts a stopped bar visible. Missing QML returns
`INVALID_PATH`; missing Quickshell or renderer failure returns `COMMAND_FAILED`.
The renderer defaults to `$LUNA_CONFIG_HOME_DIR/bar`, otherwise
`$XDG_CONFIG_HOME/luna/bar` or `~/.config/luna/bar`. Use
`--install-dir /absolute/checkout` for source QML.

```sh
bun run check
bun test packages/luna-api/tests/bar.test.ts __tests__/apps/luna-bar __tests__/apps/hypr-startup.test.ts __tests__/apps/hypr-menu-bindings.test.ts
/usr/lib/qt6/bin/qmllint --uncreatable-type disable src/luna-bar/src/shell/*.qml
python3 -m unittest discover -s src/luna-bar/tests -v
bun run --cwd src/luna-cli build --no-install
```

The QML checks use Qt Test and Quickshell with isolated offscreen windows.
Layer placement, reserved space, fullscreen hiding, and compositor keyboard focus
need a live Hyprland session. No Rust build is needed.
