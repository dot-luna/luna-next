# Luna

A Hyprland desktop setup with shared themes, app configurations, and the `luna` CLI.

On Arch Linux, run as your normal user with sudo access:

```sh
curl -fsSL https://raw.githubusercontent.com/dot-luna/luna-next/dev/install.sh | bash -s -- --ref=dev
```

This installs Git, mise, and Bun, clones Luna into `~/.local/src/luna-next`,
builds the CLI, and installs `luna` into `~/.local/bin`.
After a five-second cancellation window, it runs `luna self install` with the
same flags plus `--from-bootstrap`, skipping the checkout update and CLI rebuild.
Cancelling prints the command to finish setup later. CLI setup installs shared
prerequisites, configures Git, installs themes and their dependencies, then installs
apps in catalog order, later packages, and web apps, then applies application defaults.

Use `--install-dir=PATH` for another checkout location. `--ref=latest` follows
Git's default branch; a branch or tag name selects that ref instead.
See [installer options and recovery](install.sh), [CLI usage](src/luna-cli/README.md),
and the [package lists](installs/README.md).
