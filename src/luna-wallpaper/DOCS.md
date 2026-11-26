# Development

Requires Bun, a Wayland compositor with layer-shell support, Quickshell, FFmpeg
(`ffprobe`), and mpvpaper. Qt SVG and Image Formats plugins enable additional images.

`src/shell/` renders one wallpaper surface per monitor. Qt handles images and
GIF/WebP animations; mpvpaper handles video and animated PNGs. Each monitor plays
independently. Image replacements fade out and in after decoding, without delaying
readiness or subsequent requests. Video replacements use the player directly. Fullscreen windows pause playback on their visible workspace;
sleeping-output detection requires Hyprland.

The renderer receives validated JSON snapshots through `LUNA_WALLPAPER_SETTINGS`,
the `wallpaper.reload` IPC method, and its owned Bun config watcher. Invalid edits
keep the previous snapshot. `watch_config` controls automatic reloading.

## Checks

From the repository root:

```sh
bun test src/luna-wallpaper/tests
bunx tsc -p src/luna-wallpaper/tsconfig.json
/usr/lib/qt6/bin/qmllint src/luna-wallpaper/src/shell/*.qml
```

Tests run private offscreen shells with a fake video player. They do not verify
live Wayland placement or hardware decoding.
