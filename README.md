# Luna

A Hyprland desktop setup with shared themes, app configurations, and the `luna` CLI.

On Arch Linux, run as your normal user with sudo access:

```sh
curl -fsSL https://raw.githubusercontent.com/dot-luna/luna-next/master/install.sh | bash -s -- --ref=master
```

This installs Git, mise, and Bun, clones Luna into `~/.local/src/luna-next`,
builds the CLI, and installs `luna` into `~/.local/bin`.
Desktop setup is manual. When ready, run the command printed by the installer,
or use `~/.local/bin/luna self install` with the default checkout. This installs
Luna's packages, themes, and apps and applies their configuration.

Use `--install-dir=PATH` for another checkout location. `--ref=latest` follows
Git's default branch; a branch or tag name selects that ref instead.
See [installer options and recovery](install.sh), [CLI usage](src/luna-cli/README.md),
and the [package lists](installs/README.md).
