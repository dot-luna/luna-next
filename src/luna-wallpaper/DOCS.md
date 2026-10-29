# Luna Wallpaper

## Dependencies

| Dependency | Purpose |
| --- | --- |
| Linux, a Wayland compositor with layer-shell support, and graphics drivers | Wallpaper surfaces. |
| Quickshell and Qt 6 Quick/QML/Wayland | Run the app. Needs `Quickshell.Io`, `Quickshell.Wayland`, and `Quickshell.Hyprland` modules. |
| [LunaNext.Config](../../packages/hocon-qml/DOCS.md#build-and-install) | Read HOCON. Build/install and session import-path setup are in the module docs. |
| FFmpeg (`ffprobe`) | Detect media by content, including extensionless files. |
| [mpvpaper](https://github.com/GhostNaN/mpvpaper) and libmpv 0.38+ | Video and animated PNG playback. |
| Coreutils (`mktemp`, `rm`) on `PATH` | Temporary video files and cleanup. |
| Qt SVG and Qt Image Formats plugins | SVG and additional formats such as WebP. |

## Configuration

Uses `LUNA_WALLPAPER_CONFIG` when nonempty, otherwise
`$XDG_CONFIG_HOME/luna-next/wallpaper.conf` (default:
`~/.config/luna-next/wallpaper.conf`). Relative environment paths use the working
directory. Includes resolve relative to their source file.

Copy [example.conf](example.conf) to your config path. It lists every setting,
accepted value, and default. The app reads once at startup; restart it after
changes. It does not copy the example automatically or rewrite existing files.

The [lnxt CLI](../ln-cli/README.md) applies its config changes automatically by
restarting wallpaper. Direct file edits still need a restart.

Missing files and parent directories are created; empty files or omitted settings
use defaults. [config.schema.json](src/config.schema.json) validates resolved
settings once, without inserting defaults. Unknown settings are ignored. Invalid
known settings or config/media failures leave a black background and log an error.

## Playback

Uses the first available monitor. Qt renders still images and GIF/WebP animation;
mpvpaper handles video and animated PNG. If `ffprobe` is missing or cannot identify
the media, Qt image decoding is attempted.

Video loops silently with automatic hardware decoding when available. Personal
mpv settings and scripts are disabled. Exiting the app stops its player. Pausing
on sleeping or disabled outputs is supported on Hyprland.

## Tests

After building the config module, run from the repository root:

```sh
python3 -m unittest discover -s src/luna-wallpaper/tests -v
```

Needs Python 3, Quickshell, FFmpeg, and the built config module. Tests run
offscreen with a fake video player; they do not test live Wayland placement or
hardware decoding.
