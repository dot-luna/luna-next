# lnxt

## Installation

Run as your normal user; system packages use sudo.

```sh
lnxt install --core --main       # Combine package groups
lnxt install yay                 # Use its declared source
lnxt install --main --aur        # Filter main by source
lnxt install --pacman ripgrep    # Official package, even if unlisted
lnxt install --mise              # Declared mise tools
lnxt install --git yay           # Git package recipe
lnxt install --local cli         # Local package; --apps is an alias
lnxt configure luna-wallpaper    # Copy missing app config, build templates if needed
lnxt setup                      # Install packages and app configurations
```

Names narrow the selected groups or source. Source flags (`--pacman`, `--aur`,
`--mise`, `--git`, `--local`) are mutually exclusive. Only `--pacman`/`--aur`
can combine with `--core`/`--main`. Unlisted names need an explicit system source
without a group flag.

The [HOCON lists](../../installs/README.md) supply package objects and commands.
Setup installs pacman packages, Git recipes (including yay), AUR packages, mise
tools, then local packages. Direct AUR installs require yay already installed.
Failures stop later steps; completed work remains.

Package installs also configure matching [`apps/`](../../apps/README.md) entries;
setup configures all apps. `lnxt configure [APP...]` runs only this stage.
Builders generate files in staging, then managed defaults are refreshed. A missing
user config gets an include of those defaults; existing user files and symlinks
are kept. Configs use `XDG_CONFIG_HOME` (default `~/.config`); a nonempty `file_env`
overrides the user config's full path.

Git packages clone into `~/.local/src/<name>`. Local packages symlink their source
there, or into `destination` relative to `~/.local`, then run their commands.
Local installs refresh links and replace existing destination directories.
The current recipes install `lnxt` into `~/.local/bin`, the QML module into
`~/.local/lib/qt6/qml`, and link wallpaper into
`~/.local/share/luna-next/wallpaper`. Keep the checkout available for local links.
Set the [QML import path](../../packages/hocon-qml/DOCS.md#build-and-install)
before launching wallpaper. Installation does not start apps or change the session.

Locate the checkout with `--repo PATH`, `LUNA_NEXT_ROOT`, the current directory's
ancestors, `~/.local/src/luna-next`, or the checkout used to build the CLI (checked
in that order). The build-time fallback works while that checkout stays in place.

## Wallpaper

Use `lnxt wallpaper` (or `lnxt w`):

| Command | Action |
| --- | --- |
| `add <targets...> [-r] [--force]` | Import files, directories, or HTTP(S) URLs. |
| `list` | List wallpapers and mark the current selection. |
| `set <name/path>` / `random` | Select and apply a wallpaper. |
| `remove <names...> [--dry-run] [--yes]` | Preview or confirm library deletion. |
| `get-config [key]` | Read resolved configuration or a dot-separated key. |
| `update-config '<JSON>'` | Save partial settings and apply them. |
| `get-config-file` / `dir` / `open` | Locate configuration or open the library. |
| `start` / `stop` / `restart` / `reload` / `status` | Control the renderer. |

`set`, `random`, and `update-config` automatically reload the renderer after
configuration changes. No file watcher is needed. See the
[library docs](../../packages/luna-next/DOCS.md) for paths, dependencies, and
failure behavior.

## App integration

`--json` works before or after subcommands. Responses use
`{"ok":true,"result":...}` or `{"ok":false,"error":"..."}`. Errors exit nonzero.
Removal requires `--yes` or `--dry-run` in JSON mode or without a terminal;
it never prompts in those cases.

```sh
lnxt wallpaper get-config wallpaper.source --json
lnxt wallpaper update-config '{"wallpaper":{"fit":"fit"}}' --json
```

Without `--json`, missing keys print nothing; objects print formatted JSON.

## Tests

```sh
cargo test -p ln-cli
python3 -m unittest discover -s tests -v
```

Run these from the repository root. Installation tests use fake commands and
temporary directories; they do not install system packages.
