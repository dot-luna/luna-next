# Themes

A theme folder contains `theme.jsonc` and optional media assets. Comments and
trailing commas are supported. All fields are optional; `{}` uses Tokyo Night
defaults. Unknown keys, invalid colors, and out-of-range values fail Zod validation
in [the API schema](../packages/luna-api/src/theme/schema.ts).

```jsonc
{
  "colors": { "mode": "dark", "accent": "#82aaff" },
  "fonts": { "ui": "Outfit", "mono": "Iosevka Nerd Font" },
  "appearance": { "rounding": 8, "gaps": { "inner": 5, "outer": 8 } },
  "wallpaper": { "sources": ["wallpapers"] },
}
```

## Fields

The [bundled theme](bundled/tokyo-night/theme.jsonc) lists every supported field.

- `colors`: six-digit `#RRGGBB` values, plus `mode` (`dark` or `light`). Roles
  include background/foreground surfaces, accent, secondary accent, selection,
  muted, link, error, warning, notice, success, and info. Supplied fill colors
  derive readable foregrounds and matching emphasis unless explicitly provided.
  Light mode starts with light defaults; changing system mode does not recolor a
  fixed palette.
- `fonts.ui`, `fonts.mono`: nonblank font family names, up to 200 characters.
  Defaults are Outfit and Iosevka Nerd Font. Font packages are installed separately.
- `appearance.gaps.inner/outer`, `border_width`: nonnegative integer pixels.
  `rounding`: integer 0–100. `opacity.active/inactive/fullscreen`: 0–1.
  `blur`: `enabled`, positive integer `size`, and `passes` 1–10.
  `shadow`: `enabled`, `range` 0–100 pixels, and `falloff` 1–4.
- `wallpaper.sources`: theme-relative files/directories or HTTP(S) media URLs.
  Directories import immediate image/video files only. Paths must stay inside the
  theme folder. Imports require `file`; URLs also require `curl`. Existing different
  files are never replaced. Successfully imported files remain after later failures
  and theme removal. Installation does not select a wallpaper.

## Storage and operations

Installed copies live in `$XDG_DATA_HOME/luna/themes`; selection is
`$XDG_CONFIG_HOME/luna/theme.jsonc`, defaulting under `~/.local/share` and
`~/.config`. `LUNA_DATA_HOME_DIR` and `LUNA_CONFIG_HOME_DIR` override the Luna roots.
The API also accepts explicit paths. Theme names use lowercase letters, digits,
underscores, and hyphens, starting with a letter or digit.

`install` validates and copies author files without rewriting them. `--force`
replaces the entire named copy through Linux/coreutils directory exchange; no
backups remain. External symlinks, linked installed directories, and recursive
source/library layouts are rejected. Installed copies can be edited directly;
subsequent reads load them afresh. JSONC does not support HOCON includes or substitutions.

Selection writes normalize the owned selection file as formatted JSON, valid
JSONC. Defaults stay in memory. Reads create a missing selection as `{}`. Mutations
use a shared `flock` lock; conflicting writers fail. Atomic file writes preserve
modes and refuse detected external changes. GSettings failures attempt exact
selection and preference recovery without overwriting detected external edits.

`self install` installs all bundled themes after shared dependencies, before apps.
It selects Tokyo Night only when no theme is selected. Selection applies the system
light/dark preference through GSettings; it does not restart apps. `theme hyprland`
provides validated native appearance, and `theme get --json` supplies app hooks.
`theme apply t3code` writes T3's native palette/fonts, preserving other preferences;
fonts need an app restart. T3 files can be partially applied after a late I/O error.

See [CLI commands](../src/luna-cli/DOCS.md) and [API methods](../packages/luna-api/DOCS.md).

## Checks

```sh
bun test packages/luna-api/tests/theme.test.ts src/luna-cli/tests/theme.test.ts
bun run check
```
