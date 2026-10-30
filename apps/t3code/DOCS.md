# T3 Code

- [config/boxy.css](config/boxy.css): square corners throughout the main UI.
- The build patches square controls and desktop entry visibility. Fonts, colors,
  and math rendering use T3's native configuration; they are not compiled patches.
- The launcher runs `luna theme apply t3code` before opening T3. Install the current
  CLI into `~/.local/bin/luna` with `mise run install:ln-cli` first.
- Updates use `luna install --git t3code`. The built-in updater is disabled to
  retain square controls. Restart T3 after installation.

`luna theme apply t3code` publishes the resolved Luna palette to
`~/.t3/userdata/themes/luna-next.json` and selects it with T3's environment-theme
settings. Native JSON is required by T3; Luna theme sources remain `.conf`.
It also sets interface/composer fonts from `fonts.ui`, code/terminal fonts from
`fonts.mono`, and `mathRenderingEnabled: true` in `client-settings.json`.
Other preferences, onboarding state, font sizes, and application data are retained.
Existing native settings must use flat JSON objects; the published theme itself
must be a regular file, as required by T3. Unreadable or malformed files
fail before publication. Documents are staged and published by atomic rename;
late I/O errors can leave a partial application. Detected external edits are preserved.

T3's standard nonempty `T3CODE_HOME` overrides `~/.t3`; state lives in its
`userdata` directory. A missing Luna selection uses Tokyo Night defaults: Outfit
UI/composer and Iosevka Nerd Font code/terminal. Fonts must already be installed.
Palette changes use T3's environment-theme support; font changes need a desktop
restart. After changing Luna themes, rerun `luna theme apply t3code` or reopen T3.
No rebuild is needed for palette/font changes; changing square-control CSS needs one.

The recipe shallow-clones into `~/.local/src/t3code`, builds the selected release,
and installs to `$XDG_DATA_HOME/luna-next/t3code` (default `~/.local/share`).
The launcher is `~/.local/bin/t3code`. T3's existing data stays in place.
The single app-menu and URL-handler entry is
`$XDG_DATA_HOME/applications/com.t3tools.T3Code.desktop`. T3 keeps it visible on
startup and installs its menu icon on first launch.

Runtime libraries and fonts are in [the main package list](../../installs/packages.conf).
Build-only Arch dependencies are installed temporarily through polkit (sudo
without a desktop) and removed afterward if newly installed and unused. Existing
packages are retained. Rust, Node, pnpm, and mise remain installed.

```sh
node --test apps/t3code/tests/*.test.cjs
cargo test -p luna-next --test install_t3code --test install_manifests --test install_git
cargo test -p luna-next --test t3code_theme
cargo test -p ln-cli --test themes
```
