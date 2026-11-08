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
| `file`                                                                     | Detect image/video content for library imports, listing, selection, and removal.             |
| `curl`                                                                     | Download HTTP(S) media when importing URLs.                                                  |

`luna install luna-wallpaper` installs the app dependencies. Managing the media
library works without the renderer or Quickshell; playback and settings changes
require the installed app or a source checkout.

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
luna wallpaper install /path/to/wallpaper.png
luna wallpaper set wallpaper.png
luna wallpaper start
luna wallpaper list
luna wallpaper current
luna wallpaper path wallpaper.png
luna wallpaper random
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
`set` and `random` validate and save atomically, then apply the change to a running
renderer. Failed application restores the previous source when no external edit
would be overwritten.

After direct file edits, run `reload`. It sends a validated settings snapshot and
keeps the window and unchanged media running. `restart` performs a full stop/start.
The renderer reads no configuration files and has no file watcher. Media failures
are reported through status and the Quickshell log.

## Media library

Installed media lives in `$LUNA_DATA_HOME_DIR/wallpapers`, otherwise
`$XDG_DATA_HOME/luna/wallpapers`, then `~/.local/share/luna/wallpapers`. Theme
imports use the same library. Override it with `wallpaper --library-dir <path>`.
`path` without a name prints the directory; `current` prints the saved source.

```sh
luna wallpaper install /path/to/one.png /path/to/two.mp4
luna wallpaper add /path/to/folder
luna wallpaper install -r /path/to/folder
luna wallpaper install https://example.com/scene.jpg --name scene.jpg
luna wallpaper remove unused.png --dry-run
luna wallpaper remove unused.png --yes
```

`add` aliases `install`. Imports copy sources and leave selection unchanged.
Folders include immediate image/video files; `-r` includes subfolders and flattens
their media into one directory. Unrelated files and folder links are skipped.
`--name` accepts one file or URL, not a folder. Names are single filenames.
HTTP(S) URLs cannot contain credentials. Downloads permit at most ten HTTP(S)
redirects and sixty seconds; a URL without a filename gets a deterministic
content-based name. Media is identified by content, so extensions do not determine
acceptance; the renderer must still support decoding it.

Reimporting an identical name and bytes succeeds. Different content with the same
name fails without replacing existing files. The full batch validates before
publication; an I/O failure during publication can leave earlier files installed.
Linked library paths and overlapping source/library paths are rejected.

`set` accepts an installed filename or an absolute local path; `set ""` clears
media. `random` avoids the saved selection when another file is installed.
`list` marks the saved selection with `*`. Library imports and listing validate
the settings file too; a missing file is created automatically.

Removal accepts installed filenames only. It validates all names before deleting
any and protects the saved selection and, when the renderer is available, playing
media. Select and apply another wallpaper first. Removal prompts in a terminal;
use `--yes` in scripts or `--dry-run` to validate and print paths.

## Playback

Shows the same wallpaper on every connected monitor, including newly connected
displays. Each display applies the shared fit and playback settings independently;
video playback is not frame-synchronized between displays. Qt renders still
images and GIF/WebP animation; mpvpaper handles video and animated PNG. If
`ffprobe` is missing or cannot identify the media, Qt image decoding is attempted.

Video loops silently with automatic hardware decoding when available. Personal
mpv settings and scripts are disabled. Exiting the app stops its player. Pausing
on sleeping or disabled outputs is supported on Hyprland. Playback also pauses
while a fullscreen window covers the wallpaper's monitor and visible workspace,
and resumes when uncovered. Maximized windows and fullscreen windows on other
monitors or hidden workspaces do not pause it. Disconnecting a display stops its
player. Status is ready only when every display is ready; an error on any display
is reported as an error. With no displays, status is loading.

Images remain visible while their replacement loads. Video changes reuse the
player and surface; a brief decoding gap can still occur when switching files.

## Tests

From the repository root:

```sh
bun run --cwd packages/luna-api check
bun test packages/luna-api/tests/wallpaper-library.test.ts packages/luna-api/tests/wallpaper-store.test.ts packages/luna-api/tests/wallpaper.test.ts src/luna-cli/tests/wallpaper.test.ts
python3 -m unittest discover -s src/luna-wallpaper/tests -v
```

Library tests need `file` and `curl`. Renderer tests need Python 3, Bun, Quickshell,
and FFmpeg. They load snapshots through the real Luna API and run offscreen with a
fake video player; they do not test live Wayland placement or hardware decoding.
