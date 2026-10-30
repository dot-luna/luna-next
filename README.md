# Luna Next

Rust configuration libraries, shared themes, wallpaper, an application menu,
desktop authentication, and the `luna` CLI.

On Arch Linux, run as your normal user with sudo access:

```sh
bash scripts/setup.sh
```

This updates the system, prepares mise and Rust, installs `luna` into
`~/.local/bin`, then runs `luna setup` after five seconds. Setup installs the
declared packages, tools, and local apps, then builds and installs app
configurations, replacing their exported paths without backups, and enables the
GNOME Keyring user socket.

See [CLI commands](src/ln-cli/DOCS.md) and the [installation lists](installs/README.md).
