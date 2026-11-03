# Luna Wallpaper

## Dependencies

| Dependency                                                                 | Purpose                                                                                      |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Linux, a Wayland compositor with layer-shell support, and graphics drivers | Wallpaper surfaces.                                                                          |
| Quickshell and Qt 6 Quick/QML/Wayland                                      | Run the app. Needs `Quickshell.Io`, `Quickshell.Wayland`, and `Quickshell.Hyprland` modules. |
| FFmpeg (`ffprobe`)                                                         | Detect media by content, including extensionless files.                                      |
| [mpvpaper](https://github.com/GhostNaN/mpvpaper) and libmpv 0.38+          | Video and animated PNG playback.                                                             |
| Coreutils (`mktemp`, `rm`) on `PATH`                                       | Temporary video files and cleanup.                                                           |
| Qt SVG and Qt Image Formats plugins                                        | SVG and additional formats such as WebP.                                                     |

## Configuration

The [Luna CLI](../luna-cli/README.md) loads JSONC through the shared
[Luna API](../../packages/luna-api/DOCS.md). JSON is also accepted. Configuration
uses `--config <path>`, then nonempty `LUNA_WALLPAPER_CONFIG`, otherwise
`$LUNA_CONFIG_HOME_DIR/wallpaper.jsonc`, `$XDG_CONFIG_HOME/luna/wallpaper.jsonc`,
or `~/.config/luna/wallpaper.jsonc`. Relative paths use the working directory.

See [example.jsonc](example.jsonc) for every setting, accepted value, and default.
Missing files and parent directories are created automatically. Empty files and
omitted settings use defaults in memory. Unknown settings are preserved. Invalid
known settings are rejected before they reach the renderer.

## Commands

```sh
luna wallpaper start
luna wallpaper set /absolute/path/to/wallpaper.png
luna wallpaper get wallpaper.source
luna wallpaper reload
luna wallpaper restart
luna wallpaper status
luna wallpaper stop
```

`get` without a key returns the source settings; missing keys return `null`.
Use `luna wallpaper --config /path/to/wallpaper.jsonc <command>` for another file.
For a source checkout, add `--install-dir /absolute/path/to/luna-next` to renderer
commands and mutations, for example `luna wallpaper start --install-dir "$PWD"`
from the repository root. Use the same checkout for subsequent commands.
`set` validates and saves atomically, then applies the change to a running
renderer. Failed application restores the previous source when no external edit
would be overwritten.

After direct file edits, run `reload`. It sends a validated settings snapshot and
keeps the window and unchanged media running. `restart` performs a full stop/start.
The renderer reads no configuration files and has no file watcher. Media failures
are reported through status and the Quickshell log.

## Playback

Uses the first available monitor. Qt renders still images and GIF/WebP animation;
mpvpaper handles video and animated PNG. If `ffprobe` is missing or cannot identify
the media, Qt image decoding is attempted.

Video loops silently with automatic hardware decoding when available. Personal
mpv settings and scripts are disabled. Exiting the app stops its player. Pausing
on sleeping or disabled outputs is supported on Hyprland.

Images remain visible while their replacement loads. Video changes reuse the
player and surface; a brief decoding gap can still occur when switching files.

## Tests

From the repository root:

```sh
python3 -m unittest discover -s src/luna-wallpaper/tests -v
```

Needs Python 3, Bun, Quickshell, and FFmpeg. Tests load snapshots through the real
Luna API and run offscreen with a fake video player; they do not test live Wayland
placement or hardware decoding.
