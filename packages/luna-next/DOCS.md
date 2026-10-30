# Luna Next API

## Installation

```rust
use std::path::Path;
use luna_next::install::{get_packages, install_packages};

let packages = get_packages(Path::new("/path/to/luna-next"), &["core"], None, &[])?;
let report = install_packages(&packages)?;
```

`get_packages(repo, groups, source, names)` reads the [HOCON lists](../../installs/README.md)
and returns `Package` objects. Groups are `core`/`main`; sources are `Pacman`,
`Aur`, `Git`, `Mise`, and `Local`. Names narrow the selection; empty filters
return everything. Relative local URLs resolve from the checkout.

`install_packages(&packages)` batches by source: pacman, Git, AUR, mise, local.
`install(source, &packages)` and `install_via_*(&packages)` run one backend.
They return `Report { installed, skipped }` and stop on failure; completed work remains.
Run as a normal user; pacman uses sudo. Pacman/AUR version pinning is unsupported.

Git packages shallow-clone into `~/.local/src/<name>` and update existing checkouts.
`version` selects a branch/tag; `latest` uses Git's version sorting.
`git_release_tag_pattern` optionally narrows tags with a glob (e.g. `v*`);
`git_include_prereleases: true` includes SemVer prereleases (optional `v`).
Other tag names remain eligible. Filters do not affect explicit branches/tags.
Without a pattern, untagged remotes use the default branch; no matching or
eligible tags is an error.
Catalog recipes receive their checkout as `LUNA_NEXT_ROOT`. Git commands also
receive the selected ref as `LUNA_PACKAGE_VERSION`, unset when no ref was selected.
Local packages symlink their source into
`~/.local/src/<name>` or `destination` relative to `~/.local`.
Both run their `command` arrays from the package directory. Local installs refresh
links and replace destination directories; sources and regular files are protected.
Git changes are preserved. Local links require the checkout to remain available.

`install_app_configs(repo, names)` configures [`apps/`](../../apps/README.md);
empty names select all apps. `configure_installed_apps(repo, package_names)`
selects apps by their `package` field, ignoring unmatched packages.
Optional builders generate files in staging. Exports replace destination files
or whole folders without backups; `source: "."` exports the config directory.
File exports with `defaults` refresh that file and recreate the user entry as a
HOCON include, resetting local changes. Paths follow `XDG_CONFIG_HOME`;
`base: "home"` uses `HOME` instead. A nonempty `directory_env` overrides that base
before appending `target`; `file_env` overrides the complete file or folder path.
Relative environment overrides resolve against the working directory. Defaults
remain under `XDG_CONFIG_HOME` regardless of the export's base.

## Themes

Use `theme::Themes::from_env()` or `Themes::new(theme::Paths { config_file,
library_dir, wallpaper_dir })` for explicit paths. Relative paths use the working
directory. Theme sources and supported roles are in [the theme reference](../../themes/DOCS.md).

| Method | Behavior |
| --- | --- |
| `install(folder, name?, force)` | Validate and copy a theme folder; import declared wallpapers. Existing copies require `force`. |
| `list()`, `path(name)`, `directory()` | List installed names with selection markers or locate their files. |
| `current()`, `config_file()` | Read the optional selected name or locate selection configuration. |
| `get(key?)`, `inspect(name)` | Resolve with defaults in memory; missing keys return null. `inspect` does not select. |
| `set(name)` | Save selection and apply its system mode. Does not reload apps or choose wallpaper. |
| `mode()`, `set_mode(mode)`, `toggle()` | Read/change system preference while retaining theme colors. |
| `hyprland()` | Translate semantic `appearance` and colors to native compositor settings, without applying them. |
| `apply_t3code(state_dir)` | Publish palette and merge native font/math settings into an explicit T3 userdata directory. |
| `removal_plan(names)`, `remove(names)` | Validate a batch, protect the selected theme, and remove installed copies without prompts. |

Selection uses `$XDG_CONFIG_HOME/luna-next/theme.conf`; themes use
`$XDG_DATA_HOME/luna-next/themes`. Empty/unset XDG paths fall back to `~/.config`
and `~/.local/share`. Missing selection files are created. No selection resolves
to Tokyo Night defaults in memory. Reads resolve installed HOCON anew; there are
no watchers or generated JSON files. Source includes and comments are preserved.

Mutations share an advisory lock. Copies are validated in staging and replace
whole theme directories atomically. Directory-sync/cleanup errors may occur after
replacement. Imported wallpapers remain if a later theme publication fails;
theme removal leaves source folders and imported wallpapers intact. Removal
validates the batch before deletion; I/O failures may leave a partial batch.

Selection and mode changes use GSettings (`glib2`, `gsettings-desktop-schemas`,
`dconf`) in a user desktop session. Failed application attempts to restore the
previous preference and exact selection source, preserving detected external edits.
Legacy GTK settings and fixed application palettes are not rewritten. Portal apps
also need a Settings portal provider, such as `xdg-desktop-portal-gtk` on Hyprland.

The [T3 adapter](../../apps/t3code/DOCS.md) uses supported environment-theme and
client-settings JSON. Other preferences and existing symlinks/permissions are
retained. All documents are parsed and staged before writes; each file publishes
atomically, with optimistic checks for external edits. Late failures can leave a
partial application. T3 fonts need a desktop restart; palette updates use T3's own
environment-theme support. This method does not change Luna's selection or add watchers.

## Chromium profiles

`chromium::Chromium::from_env()` selects the default managed user-data root and
launch entries; `Chromium::new(Paths { user_data_dir, launcher, desktop_file })`
uses explicit paths. `create_profile(profile?)` creates a missing Git-named
profile without appearance or extensions. `configure_profile(config_dir, profile?)`
prepares settings for an existing profile; `configure(config_dir)` selects the
default. `setup(config_dir, profile?)` creates if needed, prepares, and opens the
native installation page. An explicit profile is its exact directory.

Configuration updates only the selected profile's web font preferences and
generated `Luna Next` folder, retaining browser data and other profiles.
`open_installation(&configured)` opens that profile for native extension/theme
confirmation; preparation alone does not install extensions. Defaults use XDG
homes, with `luna-chromium` under `~/.local/bin`. Native browser fonts follow
the desktop; generated website styles use Luna's UI and monospace fonts.

App configuration dispatch supports the `chromium` native configurator.
`install_app_configs_for_profile(repo, names, profile)` accepts only the
`chromium` app. `setup_chromium(repo, profile?)` validates its descriptor and
calls the shared setup operation. Implicit app configuration skips a missing
default profile and never opens the browser. See
[Chromium setup and limitations](../../apps/chromium/DOCS.md).

`launch_app(url, profile?)` opens an HTTP(S) URL in a visible Chromium app window
using the existing default or exact overridden profile. It shares that profile's
sessions and extensions, supports Chromium's running-process handoff, and does
not configure or create profiles. Invalid URLs, missing profiles/providers, and
immediate browser failures are errors; long-lived browser output is detached
from the caller's pipes.

## Login screen

`login::Login::from_env()` manages the screen library and user configuration;
`Login::new(Paths { config_file, screens_dir, app_dir })` supplies explicit paths.
`install(folder, name?, force)`, `list()`, `current()`, and `set(name)` manage
Luna-compatible QML screens. `get_config(key?)`, `update_config(changes)`,
`config_file()`, and `directory()` provide source-preserving configuration access.
Missing keys return null; schema failures leave the source unchanged.

`build(output)` atomically replaces the output folder with a standalone SDDM
theme, resolving Luna colors/font names and copying the selected background.
`preview()` runs a temporary build in SDDM test mode until its window exits.
`activate(installer)` builds as the caller, then runs the supplied CLI installer
under sudo with `login deploy BUNDLE`; this installs only Luna's fixed SDDM exports.
It never restarts the display manager. `deploy(bundle, &DeploymentPaths)` supports
explicit deployment paths; `deploy_system(bundle)` requires root and uses fixed
system destinations. Each deployment export publishes atomically; a later I/O
failure can leave earlier exports installed.

Configuration uses `LUNA_LOGIN_CONFIG` or `$XDG_CONFIG_HOME/luna-next/login.conf`;
screens use `$XDG_DATA_HOME/luna-next/login/screens`. The runtime is installed
under `~/.local/share/luna-next/login/app`, with a checkout fallback for development.
There are no watchers or CLI calls inside the greeter. See
[screen contracts, media dependencies, and setup](../../src/luna-login/DOCS.md).

## Menu

`menu::Menu::from_env()` controls the application menu, or use `Menu::new(Paths)`
for explicit shell/service files. `start()` validates QML/theme and starts hidden;
`show()` and `toggle()` ensure a running service before changing visibility.
`hide()` keeps a stopped menu stopped. `restart()` validates before replacement;
`stop()` leaves login startup enabled. `status()` reports IPC readiness.
`serve()` replaces its process with Quickshell and supplies resolved theme values
once. Calls use bounded subprocesses; failed new starts are stopped. Paths use
XDG homes and an optional `LUNA_NEXT_MENU_SHELL` override. See
[menu dependencies and commands](../../src/luna-menu/DOCS.md).

## Keyring

`keyring::setup()` enables and starts `gnome-keyring-daemon.socket` for the current
user. Requires `gnome-keyring` and a systemd user session; command failures return
an error. Repeated calls preserve the running daemon and unlocked keyrings.
Login unlocking uses the display manager's PAM hooks, not this API.

## Polkit

`polkit::Polkit::from_env()` controls the installed authentication agent.
`start()`, `restart()`, `stop()`, and `status()` return `Result<Status>`:
`Running`, `Unavailable`, or `Stopped`. `validate()` checks the UI/theme without
registering; `serve()` replaces the process with the foreground Quickshell agent.

Startup imports the desktop environment, enables the user service, and waits for
native registration. Existing registered prompts survive repeated starts; restart
validates first. Stop preserves login startup. Other agents are never replaced.
Theme values come from `Themes::get`; passwords stay in the native conversation.
See [installation and paths](../../src/luna-polkit/DOCS.md).

## Wallpaper

Use `luna_next::wallpaper::Wallpaper::from_env()` or `Wallpaper::new(Paths { ... })`
for explicit paths. Methods return `Result` unless they only return a path.

| API | Behavior |
| --- | --- |
| `get_config(key?)`, `config_file()` | Read effective settings or locate the user file. Missing keys return null. |
| `update_config(changes)` | Merge a JSON object, validate and save atomically, then apply it. Empty patches do nothing. |
| `add(targets, options)` | Import files, folders, or HTTP(S) URLs. Options: `recursive`, `force`. Identical files are skipped. |
| `list()`, `set(target)`, `random()` | List media with selection markers, or save and apply a selection. |
| `removal_plan(names)`, `remove(names)` | Preview or delete library files. Current and external wallpapers are protected. |
| `directory()`, `open_directory()` | Locate or open the media library. |
| `start()`, `stop()`, `restart()`, `reload()`, `status()` | Control only this renderer. Status: stopped, loading, ready, error. |

`update_config`, `set`, and `random` reload the running renderer automatically.
`reload` rereads configuration in place; `restart` replaces the process. There is
no file watcher. Unchanged media keeps playing; video changes reuse its player.
Failed application restores the exact previous config when it has not changed
externally. Includes, comments, permissions, and symlinks are preserved; defaults
are returned without copying
them into the file. Updates use nested keys; empty or dot-containing object keys
are unsupported. Schema errors leave the file unchanged.

Imports validate the complete batch before copying. Conflicting filenames need
`force`; folders recurse only when requested. Deletion has no prompts in the API;
the CLI handles confirmation. Replacing selected media restarts a running renderer
to reread the replaced file.
URL downloads are limited to 512 MiB and 120 seconds.

## Paths and setup

- Config: `LUNA_WALLPAPER_CONFIG`, otherwise `$XDG_CONFIG_HOME/luna-next/wallpaper.conf`.
- Media: `$XDG_DATA_HOME/luna-next/wallpapers`.
- Renderer: `LUNA_WALLPAPER_SHELL`, otherwise `$XDG_DATA_HOME/luna-next/wallpaper/shell/shell.qml`.

Empty/unset XDG paths default to `~/.config` and `~/.local/share`. Missing config
files and parents are created when reading or updating. `stop` works even with
invalid config. Concurrent mutations use short-lived file locks.

To use the renderer from this checkout, run from the repository root:

```sh
export LUNA_WALLPAPER_SHELL="$PWD/src/luna-wallpaper/src/shell/shell.qml"
```

Configure the [QML module import path](../hocon-qml/DOCS.md#build-and-install).
Playback needs the [wallpaper setup and dependencies](../../src/luna-wallpaper/DOCS.md).
Library operations additionally need `file`, `curl` for URLs, and `xdg-open`
(`xdg-utils`) for opening folders. Wallpaper operations do not install dependencies.

## Tests

```sh
cargo test -p luna-next
```

Tests use temporary media libraries and fake renderers; they do not change the desktop.
