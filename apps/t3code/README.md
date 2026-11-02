# T3 Code

Builds T3 Code from Git with Luna's native colors, fonts, and math rendering.
Square controls apply when Luna resolves theme rounding to zero at build time.

```sh
bun apps/t3code/scripts/configure.ts
```

The [manifest](app.jsonc) declares `before_build`, `build`, and `after_build` hooks
for preparation, compilation, and installation, plus `after_configure` for theme
settings. `luna install t3code` runs these hooks in order.

Hooks run on system Bun. Builds use Git, mise-managed upstream Node/pnpm versions,
and temporary Arch build dependencies. Clone, build, and install paths use the
`LUNA_GIT_APP_*_DIR` bases with `/t3code` appended; builds leave the clone untouched.

The installed launcher pins its AppImage path and retains installation-time theme/
profile roots as defaults, so desktop launches work without shell-only variables.
Runtime overrides for these settings remain available. The launcher refreshes the
theme on startup and disables automatic app updates.
Changing rounding requires a rebuild; palette changes do not. Restart T3 for font
changes. Existing T3 data and unrelated settings stay in place; `T3CODE_HOME`
overrides `~/.t3`. Dependency cleanup checks run with `bun test __tests__/apps/t3code`.
