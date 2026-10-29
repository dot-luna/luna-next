# Luna Next API

## Installation

```rust
use std::path::Path;
use luna_next::install::{get_packages, install_packages};

let packages = get_packages(Path::new("/path/to/luna-next"), &["core"], None, &[])?;
let report = install_packages(&packages)?;
```

`get_packages(repo, groups, source, names)` reads the [HOCON lists](../../installs/README.md)
and returns `Package` objects. Groups are `core`/`main`; sources are `Pacman`,
`Aur`, `Git`, `Mise`, and `Local`. Names narrow the selection; empty filters
return everything. Relative local URLs resolve from the checkout.

`install_packages(&packages)` batches by source: pacman, Git, AUR, mise, local.
`install(source, &packages)` and `install_via_*(&packages)` run one backend.
They return `Report { installed, skipped }` and stop on failure; completed work remains.
Run as a normal user; pacman uses sudo. Pacman/AUR version pinning is unsupported.

Git packages shallow-clone into `~/.local/src/<name>` and update existing checkouts.
`version` selects a branch/tag; `latest` uses Git's version sorting.
`git_release_tag_pattern` optionally narrows tags with a glob (e.g. `v*`);
`git_include_prereleases: true` includes SemVer prereleases (optional `v`).
Other tag names remain eligible. Filters do not affect explicit branches/tags.
Without a pattern, untagged remotes use the default branch; no matching or
eligible tags is an error.
Catalog recipes receive their checkout as `LUNA_NEXT_ROOT`. Git commands also
receive the selected ref as `LUNA_PACKAGE_VERSION`, unset when no ref was selected.
Local packages symlink their source into
`~/.local/src/<name>` or `destination` relative to `~/.local`.
Both run their `command` arrays from the package directory. Local installs refresh
links and replace destination directories; sources and regular files are protected.
Git changes are preserved. Local links require the checkout to remain available.

`install_app_configs(repo, names)` configures [`apps/`](../../apps/README.md);
empty names select all apps. `configure_installed_apps(repo, package_names)`
selects apps by their `package` field, ignoring unmatched packages.
Optional builders generate files in staging. Exports replace destination files
or whole folders without backups; `source: "."` exports the config directory.
File exports with `defaults` refresh that file and recreate the user entry as a
HOCON include, resetting local changes. Paths follow `XDG_CONFIG_HOME`; nonempty
`file_env` overrides the user config path, otherwise `target` supplies the default.

## Wallpaper

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

`update_config`, `set`, and `random` reload the running renderer automatically.
`reload` rereads configuration in place; `restart` replaces the process. There is
no file watcher. Unchanged media keeps playing; video changes reuse its player.
Failed application restores the exact previous config when it has not changed
externally. Includes, comments, permissions, and symlinks are preserved; defaults
are returned without copying
them into the file. Updates use nested keys; empty or dot-containing object keys
are unsupported. Schema errors leave the file unchanged.

Imports validate the complete batch before copying. Conflicting filenames need
`force`; folders recurse only when requested. Deletion has no prompts in the API;
the CLI handles confirmation. Replacing selected media restarts a running renderer
to reread the replaced file.
URL downloads are limited to 512 MiB and 120 seconds.

## Paths and setup

- Config: `LUNA_WALLPAPER_CONFIG`, otherwise `$XDG_CONFIG_HOME/luna-next/wallpaper.conf`.
- Media: `$XDG_DATA_HOME/luna-next/wallpapers`.
- Renderer: `LUNA_WALLPAPER_SHELL`, otherwise `$XDG_DATA_HOME/luna-next/wallpaper/shell/shell.qml`.

Empty/unset XDG paths default to `~/.config` and `~/.local/share`. Missing config
files and parents are created when reading or updating. `stop` works even with
invalid config. Concurrent mutations use short-lived file locks.

To use the renderer from this checkout, run from the repository root:

```sh
export LUNA_WALLPAPER_SHELL="$PWD/src/luna-wallpaper/src/shell/shell.qml"
```

Configure the [QML module import path](../hocon-qml/DOCS.md#build-and-install).
Playback needs the [wallpaper setup and dependencies](../../src/luna-wallpaper/DOCS.md).
Library operations additionally need `file`, `curl` for URLs, and `xdg-open`
(`xdg-utils`) for opening folders. Wallpaper operations do not install dependencies.

## Tests

```sh
cargo test -p luna-next
```

Tests use temporary media libraries and fake renderers; they do not change the desktop.
