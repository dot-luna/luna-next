# CLI usage

`luna` shows project information; `-v` prints the version. `--json` returns the
API response unchanged and suppresses progress and identity prompts. Success
exits with 0, operation failures (including partial install reports) with 1, and argument errors with 2.

## Self commands

Run as a normal Arch Linux user with sudo access, Git, and an existing Luna
checkout. Both commands accept `--install-dir PATH` and `--ref REF` (also
`--flag=value`). Checkout selection is explicit path, `LUNA_ROOT`, then
`~/.local/src/luna-next`. Relative paths start at the caller's working directory.

`--ref` accepts a branch, tag, or `latest` (the default: the remote default branch).
A branch wins over a tag with the same name. Updates reject dirty checkouts,
unrelated origins, diverged history, and switches away from unreferenced detached
commits. They never reset or autostash changes.

- `luna self install`: update the checkout, install `before_cli` packages,
  rebuild/publish the CLI, configure Git, then install `after_cli` packages,
  the mise list, themes and their packages, apps in catalog order, later packages,
  web apps, and application defaults. A direct invocation also upgrades system packages before
  installing dependencies. `install.sh` passes `--from-bootstrap` to skip the
  repeated checkout update, system upgrade, and CLI build/publication; shared
  package stages and Git configuration still run.
- `luna self update`: update the checkout and rebuild/publish only the CLI.
  Requires mise from setup; does not install desktop packages or configure Git.

Git identity values, including global include/includeIf files, are kept unless
overridden with `--git-name` or `--git-email`.
Missing values are requested through the terminal, including after a piped
bootstrap. Without a terminal, supply the flags or configure global Git identity
first. Git defaults use branch `master` and editor `nvim`; unrelated global
settings remain. Neovim is installed in `before_cli` so the editor is available.

Use `--skip-failed` with `self install` or `install` to continue after individual
app failures. The final report lists each error, its retry command and log directory;
a partial run exits 1 and reports `completed: false`, including in JSON mode.
Required checkout/package/theme failures still stop setup. Logs are retained under
`~/.local/state/luna/install-logs` by default; each run contains full command output
and a JSON summary. Bootstrap prints its retained `bootstrap.log` path.

Setup closes declared Chromium/Zen/T3 processes when needed. It warns for five
seconds, sends SIGTERM, then force-kills stragglers after three seconds. Save work
before setup, and run it from a terminal outside any app it needs to close.
`--no-close-apps` disables automatic shutdown for install/configure commands.

Mise tools are selected globally, shims are refreshed, and new Bash/Zsh sessions
activate Mise automatically. Existing terminal sessions need restarting.

Setup applies `installs/defaults.jsonc` after packages, apps, and web apps.
With `--skip-failed`, defaults are still attempted and any failure appears in the final report.
Successful setup reports completion after every stage. Early AUR recipes require
an existing Yay; theme and app stages can install the catalog’s Yay provider.

Build failures preserve the installed CLI. Completed checkout updates, packages,
and settings remain after later failures; fix the error and rerun setup.

## Checks

From the repository root:

```sh
bun run check
bun test __tests__ packages/luna-api/tests src/luna-cli/tests
bun run --cwd src/luna-cli build --no-install
```

## Build

`bun run --cwd src/luna-cli build` compiles `target/luna` and atomically replaces
`~/.local/bin/luna`. `--no-install` only compiles; bootstrap and self-update use
that mode because they own executable publication.

## Themes

`luna theme` supports `install <folder> [--name NAME] [--force]`, `list`,
`current`, `path [name]`, `get [key]`, `inspect <name>`, `set <name>`,
`mode [dark|light|toggle]`, `toggle`, `get-config-file`, `hyprland`,
`apply t3code`, and `remove <names...> [--dry-run] [--yes]`.

Use `theme --config-file PATH --library-dir PATH` for explicit selection/library
paths. JSON mode returns the same API response. Human `hyprland` output is a Lua
table; other clients use `theme get --json`. Removal protects the selected theme
and requires `--yes` or `--dry-run` without an interactive terminal.

See [theme format and behavior](../../themes/DOCS.md).

## Default applications

- `luna defaults list`: show configured choices, active defaults, and unavailable
  applications. Wildcard groups show mixed active choices when they differ.
- `luna defaults set <key> <application>`: change a system default without editing
  the defaults JSONC.
- `luna defaults reset [keys...]`: reapply configured choices; omit keys to restore
  all defaults from `installs/defaults.jsonc`.

The group accepts `--install-dir PATH` for the checkout and `--config PATH` for
an explicit defaults JSONC. Relative paths start at the caller's working directory.
JSON mode returns the API response unchanged.

Keys are `terminal`, `shell`, MIME types, URL schemes such as
`x-scheme-handler/https`, and `image/*`, `audio/*`, or `video/*`. Wildcards expand
to the MIME types supported by the selected app. Applications use installed
desktop IDs including `.desktop`; shells use an executable name or absolute path
listed in `/etc/shells`. Shell changes use `sudo chsh` and take effect at the next login.

Quote wildcard keys to prevent shell expansion:

```sh
luna defaults set 'image/*' imv.desktop
luna defaults reset 'image/*' terminal
```

## Menu

`luna menu` opens the menu; `show`, `system`, `hide`, `toggle`, `start`, `stop`, and
`status` control it. Show/system/toggle start a missing instance; start keeps it hidden.
`system` opens the session actions directly (Super+Esc).
Install with `luna install luna-menu`. Use `--install-dir PATH` on menu commands to
test source QML. Apps, About, session actions, terminal commands, URLs, and browser
search are available; other main sections remain placeholders.
See [menu controls and appearance](../luna-menu/DOCS.md).

## Wallpaper

`luna wallpaper` shows renderer status. `start`, `stop`, `restart`, `reload`, and
`status` control the renderer; `restart` replaces the process, while `reload`
applies the current settings to the running renderer.

`install <sources...>` (`add`) copies local files, imports media from folders,
or downloads HTTP(S) URLs. Add `-r`/`--recursive` to include subfolders; imported
files use their basenames in one library. Use `--name NAME` to rename one file or
URL. Images and videos are accepted. Reimporting identical content keeps the
existing copy; different content with an existing name is rejected.

`list` shows installed names and marks the selected wallpaper. `path [name]`
(`dir`) locates the library or an installed file. `set <name-or-path>` selects an
installed name or an absolute local path; `set ""` clears it. `current` reads the
saved source, and `random` selects another installed wallpaper when available.
`remove <names...> [--dry-run] [--yes]` protects selected and currently playing
media. Removal requires `--yes` or `--dry-run` without an interactive terminal.

The library defaults to `$LUNA_DATA_HOME_DIR/wallpapers`,
`$XDG_DATA_HOME/luna/wallpapers`, or `~/.local/share/luna/wallpapers`.
The group accepts `--library-dir PATH`, `--config PATH` for an explicit JSONC
file, and `--install-dir PATH` for source QML. Installed copies remain usable
after their original files move or are removed.

Use `get [key]` to read saved settings and `get-config-file` to locate the JSONC.
Settings commands are `fit <mode>`, `background <color>`,
`pause-when-inactive <true|false>`, and `transition <type> [duration]`, with durations
in milliseconds. Missing settings read as null; omitted values use renderer
defaults. Settings commands validate and save the JSONC, then reload a running
renderer. After direct file edits, run `luna wallpaper reload`.
JSON mode returns the API response unchanged.

```sh
luna wallpaper install "$HOME/Pictures/wallpaper.png"
luna wallpaper set wallpaper.png
luna wallpaper transition fade 300
```

See [wallpaper settings and setup](../luna-wallpaper/DOCS.md).

## Apps and web apps

- `luna install [names...] [--force] [--install-dir PATH]`: install and configure
  selected apps; omit names for all. Match directory IDs or package names.
- `luna configure [names...] [--install-dir PATH]`: configure without installing.
  `config` and `confi` are aliases. Apps always follow catalog order.
- `luna webapp install [name] [url]`: prompt for missing values in a terminal.
  JSON mode requires both values and never prompts.
- `luna webapp list`, `luna webapp launch <name>`,
  `luna webapp uninstall <name>`: manage apps by exact display name.

App manifests can declare Zsh shortcuts such as `ff` for `fastfetch`. After changing
them, reconfigure the app and Zsh (`luna configure fastfetch zsh`), then open a new terminal.

The `webapp` group accepts `--data-dir`, `--applications-dir`, `--launcher`,
`--profile-root`, and `--chromium` for explicit paths/browser selection. Generated
desktop entries retain their resolved paths and browser even if the desktop
session has a different environment.

Install/configure Chromium first with `luna install chromium`. Web apps open in
its `Luna` profile using app mode, without tabs/address bar. Uninstall retains
browser data. Quote names or URLs containing spaces or shell punctuation:

```sh
luna webapp install "YouTube" "https://www.youtube.com/"
```

See [app behavior](../../apps/DOCS.md) and [web-app options](../../packages/luna-api/DOCS.md#web-app-api).
