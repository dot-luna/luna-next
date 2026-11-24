# Luna

A Hyprland desktop setup with shared themes, app configurations, and the `luna` CLI.

On Arch Linux, run as your normal user with sudo access:

```sh
curl -fsSL https://raw.githubusercontent.com/dot-luna/luna-next/dev/install.sh | bash -s -- --ref=dev
```

This installs Git, mise, and Bun, clones Luna into `~/.local/src/luna-next`,
builds the CLI, and installs `luna` into `~/.local/bin`.
It stops after installing the CLI. Run `luna self install` when you want the full
Luna desktop, themes, and apps.

For a fresh Arch installation, run the bootstrap as root in the official Arch
live ISO, then run the separate script:

```sh
bash ~/.local/src/luna-next/arch-install.sh
```

It installs Arch with basic Hyprland, Kitty, Luna's login screen, and the CLI.
See [Arch installation](src/arch-install/DOCS.md) for defaults and requirements.

Use `--install-dir=PATH` for another checkout location. `--ref=latest` follows
Git's default branch; a branch or tag name selects that ref instead.
See [installer options and recovery](install.sh), [CLI usage](src/luna-cli/README.md),
and the [package lists](installs/README.md).
