# lnxt

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
JSON removal requires `--yes` or `--dry-run`; it never prompts.

```sh
lnxt wallpaper get-config wallpaper.source --json
lnxt wallpaper update-config '{"wallpaper":{"fit":"fit"}}' --json
```

Without `--json`, missing keys print nothing; objects print formatted JSON.

## Tests

```sh
cargo test -p ln-cli
```
