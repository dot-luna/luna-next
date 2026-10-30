# Luna installation

Prepare an Arch Linux user installation in `~/.local/src/luna-next`, install the
CLI, then apply Luna's package and desktop setup. Run as your normal user with
sudo access:

```sh
curl -fsSL https://raw.githubusercontent.com/dot-luna/luna-next/master/install/setup.sh | bash
```

No checkout is needed. Use the `install/install.sh` URL to install only the
checkout, shared environment, and CLI. `--ref` selects a branch or tag;
see [DOCS.md](DOCS.md) for commands, reruns, and paths.
