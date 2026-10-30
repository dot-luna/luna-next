# luna

## Installation

Run as your normal user; system packages use sudo.

```sh
luna install --core --main       # Combine package groups
luna install yay                 # Use its declared source
luna install --main --aur        # Filter main by source
luna install --pacman ripgrep    # Official package, even if unlisted
luna install --mise              # Declared mise tools
luna install --git yay           # Git package recipe
luna install --local cli         # Local package; --apps is an alias
luna configure luna-wallpaper    # Build and replace app configurations
luna configure kitty zsh starship # Refresh terminal, shell, plugins, and prompt
luna setup                      # Install packages/configs and enable the keyring socket
```

Use `--pac` for `--pacman` and `luna conf` for `luna configure`.
Aliases also appear in `--help`.

Names narrow the selected groups or source. Source flags (`--pacman`, `--aur`,
`--mise`, `--git`, `--local`) are mutually exclusive. Only `--pacman`/`--aur`
can combine with `--core`/`--main`. Unlisted names need an explicit system source
without a group flag.

The [HOCON lists](../../installs/README.md) supply package objects and commands.
Setup installs pacman packages, Git recipes (including yay), AUR packages, mise
tools, then local packages, exports app configs, and enables the GNOME Keyring
user socket. Direct AUR installs require yay already installed.
Failures stop later steps; completed work remains.

Package installs also configure matching [`apps/`](../../apps/README.md) entries;
setup configures all apps. `luna configure [APP...]` runs only this stage.
Builders generate files in staging, then exported files and folders are replaced
without backups. Managed HOCON entries are recreated with an include of their
defaults, resetting local changes. Configs use `XDG_CONFIG_HOME` (default
`~/.config`); descriptors can use `base: "home"` and `directory_env` for startup
files such as `${ZDOTDIR:-$HOME}/.zshrc`. A nonempty `file_env` overrides the full
file or folder destination.

Git packages clone into `~/.local/src/<name>`. Local packages symlink their source
there, or into `destination` relative to `~/.local`, then run their commands.
Local installs refresh links and replace existing destination directories.
The current recipes install `luna` into `~/.local/bin`, the QML module into
`~/.local/lib/qt6/qml`, and link wallpaper into
`~/.local/share/luna-next/wallpaper`, plus menu and polkit under the same base.
Keep the checkout available for local links.
Set the [QML import path](../../packages/hocon-qml/DOCS.md#build-and-install)
before launching wallpaper. Package installation does not start desktop apps;
full setup also starts the keyring socket for Secret Service activation.

Locate the checkout with `--repo PATH`, `LUNA_NEXT_ROOT`, the current directory's
ancestors, `~/.local/src/luna-next`, or the checkout used to build the CLI (checked
in that order). The build-time fallback works while that checkout stays in place.

## Chromium

```sh
luna install ungoogled-chromium-bin
luna chromium setup
```

The package replaces conflicting regular Chromium through the package manager
while preserving existing profiles. Setup creates the Git-named Luna profile if
missing, prepares extensions, theme colors, web fonts and square website corners,
then opens that profile for native installation confirmations.

Use `luna chromium create-profile` to create it separately, then
`luna conf chromium` to apply settings to the existing profile. Either command
accepts `--profile PATH` for an exact profile directory; setup accepts the same
option. No profile override selects the Git-created profile. Configuration never
creates a missing profile; setup does.

Close Chromium first. Other profiles and the desktop default-browser choice
remain unchanged. Rerun configuration to refresh theme values or downloaded
extensions. See [Chromium details and limitations](../../apps/chromium/DOCS.md).

## Themes

From the repository root, after installing the CLI:

```sh
luna theme install themes/bundled/tokyo-night
luna theme set tokyo-night
luna theme get appearance --json
```

| Command | Action |
| --- | --- |
| `install <folder> [--name NAME] [--force]` | Validate/copy `theme.conf` and import declared wallpapers. |
| `list` / `current` / `path [name]` | List themes, read selection, or locate copies. |
| `get [key]` / `inspect <name>` | Read resolved values with defaults, or preview an installed theme. |
| `set <name>` | Save selection and apply its system light/dark preference. |
| `mode [dark/light/toggle]` / `toggle` | Read/change system preference, keeping theme colors. |
| `get-config-file` | Locate selection configuration. |
| `hyprland` | Output native appearance as a Lua table; `--json` returns a JSON object. |
| `apply t3code` | Apply Luna's palette, UI/monospace fonts, and math rendering through T3's native JSON settings. |
| `remove <names...> [--dry-run] [--yes]` | Preview or confirm deletion; the selected theme is protected. |

Themes use HOCON `.conf` files, with semantic `colors`, `fonts`, `appearance`, and
`wallpaper` sections. See [theme fields and authoring](../../themes/DOCS.md).
Selection does not reload apps or change wallpapers. With the installed
[Hyprland configuration](../../apps/hypr/DOCS.md), reload Hyprland to apply appearance.
Run `luna configure kitty starship` to regenerate terminal colors, its monospace
font, and the prompt palette from the selection. Restart Kitty and open a new
shell after configuring; see [Kitty](../../apps/kitty/DOCS.md) and
[Zsh](../../apps/zsh/DOCS.md) for their native paths and overrides.

System mode needs GSettings and a user desktop session; its dependencies are in
`luna install --main`. Portal apps need a Settings provider such as
`xdg-desktop-portal-gtk`. Fixed palettes and legacy GTK overrides may take precedence.
Failed application attempts source and preference recovery without overwriting
detected external edits.

The managed T3 launcher applies Luna's theme on startup. Run
`luna theme apply t3code` to refresh an open app's palette; restart T3 for fonts.
It honors `T3CODE_HOME` (default `~/.t3`) and retains unrelated preferences.
See [T3 setup and limitations](../../apps/t3code/DOCS.md).

## Menu

```sh
luna install --local cli menu
luna menu
luna menu toggle
```

The menu contains only **Apps** and its searchable installed-application list.
`start` prepares a hidden instance and enables login startup; `show` (the default)
and `toggle` start it when needed. `hide`, `stop`, `restart`, `status`, and the
service's foreground `serve` are also available. Restart after changing themes.
The managed Hyprland configuration starts the menu at login and binds Super+Space
to toggle it. See [menu setup and behavior](../luna-menu/DOCS.md).

## Keyring

```sh
luna install --pacman gnome-keyring
luna keyring setup
```

Full setup includes this step. It enables the package's user socket now and for
future logins, without restarting an existing daemon. Arch SDDM already supplies
the PAM hooks to unlock the login keyring with your login password. Its password
must match your account password; autologin and fingerprint-only login cannot
provide it. Other login managers need their own
[PAM integration](https://wiki.gnome.org/Projects/GnomeKeyring/Pam).
No password is saved by Luna, and this does not change sudo or polkit prompts.

## Polkit

```sh
luna install --local cli polkit
luna polkit start
luna polkit status
```

`start` validates the UI, enables session startup, and confirms native registration.
`restart` validates before replacing the agent; `stop` stops it for this session.
`serve` runs the foreground process used by systemd. Status is `running`,
`unavailable`, or `stopped`. See [polkit setup and tests](../luna-polkit/DOCS.md).

## Wallpaper

Use `luna wallpaper` (or `luna w`):

| Command | Action |
| --- | --- |
| `add <targets...> [-r] [--force]` | Import files, directories, or HTTP(S) URLs. |
| `list` | List wallpapers and mark the current selection. |
| `set <name/path>` / `random` | Select and apply a wallpaper. |
| `remove <names...> [--dry-run] [--yes]` | Preview or confirm library deletion. |
| `get-config [key]` | Read resolved configuration or a dot-separated key. |
| `update-config '<JSON>'` | Save partial settings and apply them. |
| `get-config-file` / `dir` / `open` | Locate configuration or open the library. |
| `start` / `stop` / `restart` / `reload` / `status` | Control the renderer. |

`set`, `random`, and `update-config` automatically reload the renderer after
configuration changes. `reload` keeps the process running; `restart` stops and
starts it. No file watcher is needed. See the
[library docs](../../packages/luna-next/DOCS.md) for paths, dependencies, and
failure behavior.

## Login screen

```sh
luna install --local cli login
luna login preview
luna login activate
```

`login` manages [Luna-compatible SDDM screens](../luna-login/DOCS.md).
`install <folder> [--name NAME] [--force]` copies a screen containing `Screen.qml`;
`list`, `current`, and `set <name>` manage the saved selection. The bundled
`default` screen is available immediately.

`get-config [key]`, `update-config '<JSON>'`, and `get-config-file` read or edit
`login.conf`. `dir` locates the screen library. Selection/config edits preserve
HOCON includes and require an explicit build or activation to apply them.

`build <output>` replaces that folder with a self-contained SDDM theme: selected
QML, resolved Luna colors/fonts, and copied background media. `preview` builds a
temporary copy and opens SDDM test mode; it does not authenticate or change the
active theme. It runs in the foreground and rejects `--json`.

`activate` builds as the current user, then uses sudo to publish the theme under
`/usr/local/share/luna-next/login/active` and select it through
`/etc/sddm.conf.d/90-luna-next.conf`. It affects the next login screen without
restarting SDDM. Refresh the snapshot after theme or config changes by activating
again. Fonts must already be installed system-wide.

## App integration

`--json` works before or after subcommands. Responses use
`{"ok":true,"result":...}` or `{"ok":false,"error":"..."}`. Errors exit nonzero.
Removal requires `--yes` or `--dry-run` in JSON mode or without a terminal;
it never prompts in those cases.

```sh
luna wallpaper get-config wallpaper.source --json
luna wallpaper update-config '{"wallpaper":{"fit":"fit"}}' --json
```

Without `--json`, `set` and `random` print the selected path; `update-config`
prints a confirmation. `get-config` prints values as text or formatted JSON;
missing keys print nothing.

## Tests

```sh
cargo test -p ln-cli
python3 -m unittest discover -s tests -v
```

Run these from the repository root. Installation tests use fake commands and
temporary directories; they do not install system packages.
