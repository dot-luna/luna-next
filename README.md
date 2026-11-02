# Luna

A Hyprland desktop setup with shared themes, app configurations, and the `luna` CLI.

On Arch Linux, run as your normal user with sudo access:

```sh
curl -fsSL https://raw.githubusercontent.com/dot-luna/luna-next/master/install.sh | bash
```

This installs Git, mise, and Bun, clones Luna into `~/.local/src/luna-next`,
builds the CLI, and installs `luna` into `~/.local/bin`.
After a five-second cancellation window, it runs `luna self install` with the
same flags plus `--no-git-pull`, since the checkout is already prepared.
Cancelling prints the command to finish setup later. The `self install` command
is pending implementation; desktop setup is not available yet.

Use `--install-dir=PATH` for another checkout location. `--ref=latest` follows
Git's default branch; a branch or tag name selects that ref instead.
See [installer options and recovery](install.sh), [CLI usage](src/luna-cli/README.md),
and the [package lists](installs/README.md).
