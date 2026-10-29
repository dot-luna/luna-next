# T3 Code

- [config/defaults.json](config/defaults.json): Outfit for the interface/composer,
  Iosevka Nerd Font for code/terminal, and `mathRenderingEnabled: true`.
- [config/boxy.css](config/boxy.css): square corners throughout the main UI.
- Defaults are compiled into T3. Rebuild after editing them; existing explicit
  preferences still apply. An empty font preference uses Luna's built-in font.
- Updates use `lnxt install --git t3code`. The built-in updater is disabled to
  retain the patch. Restart T3 after installation.

The recipe shallow-clones into `~/.local/src/t3code`, builds the selected release,
and installs to `$XDG_DATA_HOME/luna-next/t3code` (default `~/.local/share`).
The launcher is `~/.local/bin/t3code`. T3's existing data stays in place.

Runtime libraries and fonts are in [the main package list](../../installs/packages.conf).
Build-only Arch dependencies are installed temporarily through polkit (sudo
without a desktop) and removed afterward if newly installed and unused. Existing
packages are retained. Rust, Node, pnpm, and mise remain installed.

```sh
node --test apps/t3code/tests/*.test.cjs
cargo test -p luna-next --test install_t3code --test install_manifests --test install_git
```
