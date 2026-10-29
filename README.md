# Luna Next

Rust configuration libraries, a wallpaper app, and the `lnxt` CLI.

On Arch Linux, run as your normal user with sudo access:

```sh
bash scripts/setup.sh
```

This updates the system, prepares mise and Rust, installs `lnxt` into
`~/.local/bin`, then runs `lnxt setup` after five seconds. Setup installs the
declared packages, tools, and local apps, then builds and installs app
configurations, replacing their exported paths without backups.

See [CLI commands](src/ln-cli/DOCS.md) and the [installation lists](installs/README.md).
