# Luna Next

Rust configuration libraries, shared themes, wallpaper, an application menu,
desktop authentication, and the `luna` CLI.

On Arch Linux, run as your normal user with sudo access:

```sh
bash install/setup.sh
```

This installs Git and build tools, clones Luna into `~/.local/src/luna-next`,
installs `luna` into `~/.local/bin`, and runs `luna setup`. The installed checkout
supplies packages and app sources independently of your development folder.
Setup replaces declared configuration exports without backups.

See [installation](install/DOCS.md), [CLI commands](src/ln-cli/DOCS.md), and
the [package lists](installs/README.md).
