# Installation and setup

Requires Arch Linux, Bash, sudo access, and a normal user account. The installer
updates system packages and installs Git, GCC, mise, and stable Rust.

## Commands

From an existing checkout:

```sh
bash install/install.sh # Install checkout, environment, and CLI
bash install/setup.sh   # Install, then run the installed luna setup
```

To install without a checkout, fetch the standalone installer with `curl`:

```sh
curl -fsSL https://raw.githubusercontent.com/dot-luna/luna-next/master/install/install.sh | bash
"$HOME/.local/bin/luna" setup
```

Installation clones `https://github.com/dot-luna/luna-next.git` into
`~/.local/src/luna-next` and builds `~/.local/bin/luna` from there. It does not
run full setup. The setup script installs first, then calls `luna setup --repo`
with that managed checkout. Full setup installs the
[package lists](../installs/README.md), replaces app exports, enables keyring,
and installs declared web apps. Completed steps remain if a later step fails.

## Environment and repository selection

The installer exports `LUNA_NEXT_ROOT` for its commands and writes
`$XDG_CONFIG_HOME/environment.d/60-luna-next.conf` (default `~/.config`) for
user services and future sessions. It includes `~/.local/bin` in `PATH`.
Managed Zsh and Hyprland supply the same repository default to their child apps;
nonempty explicit environment values remain supported. Start a new terminal or
desktop session to refresh existing processes. The installer also refreshes the
running user service manager when one is available.

CLI repository selection is `--repo PATH`, nonempty `LUNA_NEXT_ROOT`, then
`~/.local/src/luna-next`. Working-directory ancestors are a development fallback
only when that managed directory is absent. Invalid selected checkouts return
errors. The path used to compile Luna is never a runtime default. Use `--repo`
to work on another checkout deliberately.

## Reruns and checks

Reruns fast-forward the clean managed `master` checkout and reinstall the CLI.
Linked paths, unrelated repositories, another branch, and local changes are
rejected without deleting them. The managed checkout must remain available:
installed local app sources link into it. The environment file is replaced
without backups; shell startup files outside Luna's exports are not edited.

From the repository root:

```sh
bash -n install/install.sh install/setup.sh
python3 -m unittest discover -s tests -v
cargo test -p luna-next -p ln-cli
```

Bootstrap tests use temporary homes and fake commands; they do not update the
system, download repositories, or run desktop setup.
