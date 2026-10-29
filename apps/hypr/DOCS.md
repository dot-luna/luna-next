# Hyprland configuration

Uses Hyprland's Lua API; verified with Hyprland 0.57.0.

## Installation

`lnxt configure hypr` installs files under
`$XDG_CONFIG_HOME/luna-next/hypr` (default `~/.config/luna-next/hypr`). Setup and
Hyprland package installation also configure these files. Each run replaces the
exported folder without backups. Your active Hyprland config is unchanged; connect
it with the `dofile` in [README.md](README.md), then reload Hyprland when ready.

The configuration needs Kitty, `xdg-terminal-exec`, `flock` (util-linux), and
`gtk-launch`/`xdg-mime` (gtk3/xdg-utils) for its application shortcuts. Session
startup runs the installed `~/.local/bin/lnxt wallpaper start` with the local QML
import path. Install the [wallpaper app](../../src/luna-wallpaper/DOCS.md) first.

## Defaults

- Preferred display modes, automatic positions, scale 1.
- Workspaces 1–10 split across displays in physical order; hotplug preserves
  focus and personal workspaces.
- Keyboard repeat 40/250 ms, touchpad tapping, and three-finger workspace swipes.
- Tokyo Night borders, square corners, gaps, opacity, blur, and spring animations.
- Zen Picture-in-Picture, portal dialogs, and a dedicated Kitty drop-down rule.
- Wallpaper starts at login; config reloads do not restart it.

## Shortcuts

| Keys | Action |
| --- | --- |
| Super+Enter / Super+Shift+Enter | Default terminal / browser. |
| Super+W / Super+Shift+W | Close window / workspace windows. |
| Super+F / Super+Alt+F | Fullscreen / maximize. |
| Super+T / Super+J / Super+P | Floating / split direction / pseudo tiling. |
| Super+arrows / Super+Shift+arrows | Focus / swap windows. |
| Alt+Tab / Alt+Shift+Tab | Cycle windows. |
| Super+left/right mouse drag | Move / resize. |
| Super+minus/equal | Resize width; Shift selects height, Alt uses smaller steps. |
| Super+1–0 | Select workspace 1–10. |
| Super+Shift+1–0 | Move and follow; add Alt to stay. |
| Super+Tab / Super+Shift+Tab | Next / previous workspace on this monitor. |
| Ctrl+Alt+Tab | Next monitor; add Shift for previous. |
| Super+S / Super+Alt+S | Toggle scratchpad / move window there. |
| Super+backtick | Toggle drop-down terminal. |
| Super+G / Super+Alt+G | Toggle group / remove window from group. |
| Super+O | Toggle a pinned floating window. |
| Super+slash / Super+Alt+slash | Increase / decrease monitor scale. |
| Super+Ctrl+Z / Super+Ctrl+Alt+Z | Zoom in / reset zoom. |
| Super+Ctrl+L | Toggle dwindle/scrolling for this workspace. |
| Super+Shift+Backspace / Super+Backspace | Toggle gaps / opacity. |
| Super+Ctrl+Backspace | Toggle square aspect for a lone tiled window. |

## Checks

From the repository root; these do not reload the running desktop:

```sh
Hyprland --verify-config -c apps/hypr/config/hyprland.lua
python3 -m unittest discover -s apps/hypr/tests -v
```

Tests use Lua, Hyprland, and temporary configuration directories.
