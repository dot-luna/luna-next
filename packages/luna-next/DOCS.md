# Luna Next API

Use `luna_next::wallpaper::Wallpaper::from_env()` or `Wallpaper::new(Paths { ... })`
for explicit paths. Methods return `Result` unless they only return a path.

| API | Behavior |
| --- | --- |
| `get_config(key?)`, `config_file()` | Read effective settings or locate the user file. Missing keys return null. |
| `update_config(changes)` | Merge a JSON object, validate and save atomically, then apply it. Empty patches do nothing. |
| `add(targets, options)` | Import files, folders, or HTTP(S) URLs. Options: `recursive`, `force`. Identical files are skipped. |
| `list()`, `set(target)`, `random()` | List media with selection markers, or save and apply a selection. |
| `removal_plan(names)`, `remove(names)` | Preview or delete library files. Current and external wallpapers are protected. |
| `directory()`, `open_directory()` | Locate or open the media library. |
| `start()`, `stop()`, `restart()`, `reload()`, `status()` | Control only this renderer. Status: stopped, loading, ready, error. |

`update_config`, `set`, and `random` restart the one-shot renderer automatically.
`reload` also restarts; there is no file watcher. Failed application restores the
exact previous config when it has not changed externally. Includes, comments,
permissions, and symlinks are preserved; defaults are returned without copying
them into the file. Updates use nested keys; empty or dot-containing object keys
are unsupported. Schema errors leave the file unchanged.

Imports validate the complete batch before copying. Conflicting filenames need
`force`; folders recurse only when requested. Deletion has no prompts in the API;
the CLI handles confirmation. Replacing selected media reloads a running renderer.

## Paths and setup

- Config: `LUNA_WALLPAPER_CONFIG`, otherwise `$XDG_CONFIG_HOME/luna-next/wallpaper.conf`.
- Media: `$XDG_DATA_HOME/luna-next/wallpapers`.
- Renderer: `LUNA_WALLPAPER_SHELL`, otherwise `$XDG_DATA_HOME/luna-next/wallpaper/shell/shell.qml`.

Empty/unset XDG paths default to `~/.config` and `~/.local/share`. Missing config
files and parents are created when reading or updating. `stop` works even with
invalid config. Concurrent mutations use short-lived file locks.

Set `LUNA_WALLPAPER_SHELL` to the renderer's `shell.qml` when running it from
another location. Configure the [QML module import path](../hocon-qml/DOCS.md#build-and-install).
Playback needs the [wallpaper setup and dependencies](../../src/luna-wallpaper/DOCS.md).
Library operations additionally need `file`, `curl` for URLs, and `xdg-open`
(`xdg-utils`) for opening folders. Dependencies are never installed automatically.

## Tests

```sh
cargo test -p luna-next
```

Tests use temporary media libraries and fake renderers; they do not change the desktop.
