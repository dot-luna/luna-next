# Themes

A theme folder contains `theme.jsonc` and optional media assets. Comments and
trailing commas are supported. All fields are optional; `{}` uses Tokyo Night
defaults. Unknown keys, invalid colors, and out-of-range values fail Zod validation
in [the API schema](../packages/luna-api/src/theme/schema.ts).

```jsonc
{
  "colors": { "mode": "dark", "accent": "#82aaff" },
  "fonts": { "ui": "Outfit", "mono": "Iosevka Nerd Font" },
  "packages": [
    { "name": "ttf-iosevka-nerd", "source": "pacman" },
    { "name": "ttf-outfit", "source": "aur" },
  ],
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
  Defaults are Outfit and Iosevka Nerd Font. Declare required fonts in `packages`.
- `appearance.gaps.inner/outer`, `border_width`: nonnegative integer pixels.
  `rounding`: integer 0–100. `opacity.active/inactive/fullscreen`: 0–1.
  `blur`: `enabled`, positive integer `size`, and `passes` 1–10.
  `shadow`: `enabled`, `range` 0–100 pixels, and `falloff` 1–4.
- `wallpaper.sources`: theme-relative files/directories or HTTP(S) media URLs.
  Directories import immediate image/video files only. Paths must stay inside the
  theme folder. Imports require `file`; URLs also require `curl`. Existing different
  files are never replaced. Successfully imported files remain after later failures
  and theme removal. Installation does not select a wallpaper.

## Theme packages

`packages` is an optional array of `{ "name": "package-name", "source": "pacman" | "aur" }`.
Only Pacman and AUR are supported; mise, Git, URLs, and version fields are rejected.
Tokyo Night declares `ttf-iosevka-nerd` (Pacman) and `ttf-outfit` (AUR) for its fonts.
Partial themes inherit visual defaults, but do not inherit package declarations.

`theme install` installs missing packages before publishing the installed copy.
`theme set` checks again before changing selection, so removed dependencies are
restored before activation. `pacman -Qq` detects installed packages; Pacman uses
sudo and AUR uses Yay, both with `--needed --noconfirm`. Pacman and the required
installer must already be available when packages are missing. Installed packages
do not require their original installer. Authenticate sudo
first if needed. Self-install builds Yay from the app catalog only when missing
AUR theme packages require it. Read commands never install packages. Removing a theme retains
its packages. A package failure keeps the previous installed copy or selection;
packages already installed remain.

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
selection, generated GTK stylesheet, and desktop preference recovery without
overwriting detected external edits.
Appearance commands reuse the supplied session bus or its XDG runtime socket.
Without one, `dbus-run-session` starts a private bus so dconf can persist settings
from TTY/SSH sessions. This requires the `dbus` package, installed during setup.

`self install` installs all bundled themes after shared dependencies, before apps.
It selects Tokyo Night only when no theme is selected. `theme set`, `theme mode`,
and `theme toggle` apply the system light/dark preference and generate GTK3 styling
from the selected Luna palette, fonts, and `appearance.rounding`. GTK keeps its
built-in widget layout; Luna supplies colors for surfaces, text, controls, and
selection. The UI font applies generally; widgets marked monospace use `fonts.mono`.
Control and menu corners follow rounding where GTK's grouped or circular control
geometry does not take precedence. Authored colors stay fixed when system mode
changes. Generated stylesheets live under
`$XDG_DATA_HOME/themes/Luna/gtk-3.0/gtk.css` and `Luna-alt/gtk-3.0/gtk.css`, defaulting
under `~/.local/share`. Luna switches native theme names when styling changes so
GTK can reload without a file watcher. Generated files and saved dconf preferences
persist across app restarts and desktop logins.

GTK3 on Wayland reads the GSettings theme; X11 requires an XSettings bridge,
which Luna does not configure. GNOME/libadwaita receives the system dark/light
preference; its palette is not customized. App overrides can take precedence,
and some apps need reopening; Luna does not restart them. `theme hyprland`
provides validated native appearance, and `theme get --json` supplies app hooks.
`theme apply t3code` writes T3's native palette/fonts, preserving other preferences;
fonts need an app restart. T3 files can be partially applied after a late I/O error.

See [CLI commands](../src/luna-cli/DOCS.md) and [API methods](../packages/luna-api/DOCS.md).

## Checks

```sh
bun test packages/luna-api/tests src/luna-cli/tests/theme.test.ts
bun run check
```

Native GTK3 style checks also run when Python/PyGObject and a Wayland or X11
display are available.
