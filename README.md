# Luna Next

Rust configuration libraries, shared themes, wallpaper, an application menu,
desktop authentication, and the `luna` CLI.

On Arch Linux, run as your normal user with sudo access:

```sh
curl -fsSL https://raw.githubusercontent.com/dot-luna/luna-next/master/install.sh | bash
```

This prepares package sources and Bun, clones Luna into `~/.local/src/luna-next`,
builds the logger, API, and CLI, and installs `luna` into `~/.local/bin`.
After a five-second cancellation window, it runs `luna self install` with the
same flags. Cancelling prints the command to finish setup later.

Use `--install-dir=PATH` for another checkout location. `--ref=latest` follows
Git's default branch; a branch or tag name selects that ref instead.
See [installer options and recovery](install.sh), [CLI commands](src/ln-cli/DOCS.md),
and the [package lists](installs/README.md).
