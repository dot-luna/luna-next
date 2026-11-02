# luna

Bun CLI for app installation, configuration, and runtime actions, using
the shared [`luna-api`](../../packages/luna-api/src/index.ts).

Install to `~/.local/bin/luna` from the repository root:

```sh
mise run install:ln-cli
export PATH="$HOME/.local/bin:$PATH"
luna list --json
```

Use `luna --help` for commands. Theme, wallpaper, and other Rust commands are
pending replacement; [DOCS.md](DOCS.md) still describes those removed commands.
