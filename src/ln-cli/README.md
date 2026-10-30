# luna

Package installation, theme, and wallpaper commands for terminals, menus, and other apps.
Uses the shared
[`luna-next` library](../../packages/luna-next/README.md).

Install to `~/.local/bin/luna` from the repository root:

```sh
mise run install:ln-cli
export PATH="$HOME/.local/bin:$PATH"
luna wallpaper list --json
```

See [DOCS.md](DOCS.md) for commands and JSON responses.
