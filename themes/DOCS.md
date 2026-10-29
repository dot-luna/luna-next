# Theme format

A theme folder contains `theme.conf` and any files it includes. All fields are
optional; an empty object is valid. Unknown fields, invalid colors, and unsupported
appearance values fail [schema validation](theme.schema.json). No Lua is evaluated.

```hocon
colors {
  mode = "dark"
  accent = "#82aaff"
}
fonts {
  ui = "Outfit"
  mono = "Iosevka Nerd Font"
}
appearance {
  rounding = 8
  gaps { inner = 5, outer = 8 }
  opacity { active = 0.95 }
}
wallpaper {
  sources = ["wallpapers"]
}
```

Omitted fields inherit Tokyo Night defaults. `colors.mode = "light"` chooses light
surface/text defaults before applying overrides. Objects merge recursively; arrays
replace. Defaults and derived colors stay in memory. Theme sources, includes, and
unrelated text are never replaced with resolved data.

## Colors

`mode` is `dark` or `light`. All other colors are opaque `"#RRGGBB"` strings.

| Fields | Purpose |
| --- | --- |
| `background`, `dark_background`, `darker_background`, `lighter_background` | Normal, lower, deepest, and raised surfaces. |
| `foreground`, `light_foreground`, `bright_foreground` | Readable text/icons with increasing emphasis. |
| `dark_foreground` | Disabled/decorative elements; not ordinary secondary text. |
| `accent`, `selection`, `secondary_accent` | Primary fill, selected-content fill, supporting accent. |
| `muted` | Subdued decoration/fills; use `bright_foreground` for text on it. |
| `link`, `comment` | Readable links and code comments. |
| `error`, `warning`, `notice`, `success`, `info` | Status text, icons, or fills. |
| `accent_foreground`, `selection_foreground`, `secondary_accent_foreground` | Text/icons on the corresponding fill. |
| `error_foreground`, `warning_foreground`, `notice_foreground`, `success_foreground`, `info_foreground` | Text/icons on status fills. |
| `error_emphasis`, `warning_emphasis`, `success_emphasis`, `info_emphasis`, `link_emphasis`, `secondary_accent_emphasis` | Stronger role variants. Filled variants reuse their base foreground. |

Changing a fill without its foreground derives readable black or white. Changing
a role without its emphasis variant makes that variant follow the new base color.
Explicit author values win. Muted/disabled colors are intentionally decorative.
The bundled dark and default light palettes have regression checks for 4.5:1 text
contrast against normal/raised surfaces and for fill/foreground pairs; custom
palettes must be checked by their author.

## Shared appearance and fonts

`appearance` contains reusable visual values. App adapters translate them into
native settings; unsupported effects are left to each app. App layouts, keybindings,
monitor scaling, font sizes, and package names stay outside themes.

| Path within `appearance` | Type and units |
| --- | --- |
| `gaps.inner`, `gaps.outer` | Nonnegative integers; gaps between windows and screen edges, in layout pixels. |
| `border_width` | Nonnegative integer, layout pixels. |
| `rounding` | Integer 0–100, layout pixels. |
| `opacity.active`, `opacity.inactive`, `opacity.fullscreen` | Numbers 0–1. |
| `blur.enabled`, `shadow.enabled` | Booleans. |
| `blur.size` | Positive integer. |
| `blur.passes` | Integer 1–10. |
| `shadow.range` | Integer 0–100, pixels. |
| `shadow.falloff` | Integer 1–4; shadow falloff strength. |

`fonts.ui` and `fonts.mono` are nonempty font family names, up to 200 characters,
without control characters. Defaults are Outfit and Iosevka Nerd Font. Install fonts
separately; theme installation does not install packages.

The [bundled Tokyo Night theme](bundled/tokyo-night/theme.conf) supplies every
supported field with defaults and an empty wallpaper list. The current Hyprland
adapter maps appearance to gaps, borders, rounding, opacity, blur, and shadows;
border colors come from accent/muted and shadow hues from the darker backgrounds.

## Installation and use

See [CLI commands](../src/ln-cli/DOCS.md#themes). Theme names start with a lowercase
letter or digit and contain lowercase letters, digits, underscores, or hyphens.
Copies live in `$XDG_DATA_HOME/luna-next/themes`; selection is
`$XDG_CONFIG_HOME/luna-next/theme.conf`, normally under `~/.local/share` and
`~/.config`. New writes use nested blocks. Installation replaces a whole named
copy only with `--force`, after validation; no backups are made.

Keep relative includes inside the theme folder. External absolute includes remain
external dependencies. Installed copies can be edited directly; subsequent reads
resolve them again. Reinstall first when editing the original source folder.
Selection changes do not reload applications. Hyprland reads through the installed
CLI on startup/reload; other clients can use `lnxt theme get --json` or the Rust API.
There are no watchers or generated JSON theme files.

`wallpaper.sources` accepts theme-relative files/directories or public HTTP(S) media
URLs. Local paths must stay inside the theme folder. Installation imports through
the wallpaper library without recursion or replacement of conflicting filenames.
It does not choose a wallpaper; use `lnxt wallpaper set`. Removal keeps imported
wallpapers. Sources may be empty. Imports need `file`, plus `curl` for URLs.

## Checks

From the repository root:

```sh
cargo test -p luna-next --test themes
cargo test -p ln-cli --test themes
python3 -m unittest discover -s apps/hypr/tests -v
```
