# Luna API

`Luna.info(options?)` reads the checkout's root `package.json` on every call.
`Luna.self.install(options?)` installs prerequisites, Git configuration, themes, apps, later packages, and web apps, then applies default applications.
`Luna.self.update(options?)` updates the checkout and rebuilds/publishes only the CLI.

All operations return `{ succes: true, data }` or
`{ succes: false, err, errMessage }`. The `succes` spelling is the API contract.
The API does not print. Installation commands save full stdout/stderr to private
run logs and optionally call `onProgress(message)`; failed commands return diagnostics.

## Self options and behavior

- `repository`: checkout path; overrides `LUNA_ROOT`, then the default
  `$HOME/.local/src/luna-next`. Relative paths use the caller's working directory.
- `env`: replaces the operation environment; defaults to `Bun.env`. HOME must be
  an absolute non-root home. The caller's environment and cwd remain unchanged.
- `ref`: branch, tag, or `latest` (remote default branch). Defaults to `latest`.
- `onProgress`: optional synchronous progress callback.
- `skipFailed`: continue after individual app, web-app, and final defaults failures (default false).
- `closeApps`: close declared app processes before installation/configuration (default true).

Self operations require an existing standalone Luna checkout and a normal Arch
Linux user with Git, pacman, Bash, and sudo available. Updates preserve local edits
and commits, use fast-forward pulls, and do not replace local tags.

Installation additionally accepts `fromBootstrap` to skip the checkout update,
system upgrade, and CLI build already performed by `install.sh`; package stages
still run. Order: validate, update checkout, `before_cli` packages, build/publish
CLI, Git configuration, `after_cli` packages/mise tools, bundled themes and their
packages, apps in catalog order, later packages, web apps, then application defaults. Direct installation
upgrades system packages before installing dependencies.

Use `git: { name?, email? }` to override global identity values. Otherwise existing
values, including global include/includeIf files, are retained without new identity
overrides. `requestGitIdentity(current)` may supply missing values;
the API itself never prompts. Git defaults use `master` and `nvim`, with Neovim
in the before-CLI dependencies. Unrelated global Git settings are retained.

Success returns `completed: true`, `installedApps`, `installedWebapps`, and an empty
`pending` array; `cliRebuilt` reports whether CLI publication ran. No completion is
returned after a failed required stage. With `skipFailed`, individual app failures
return a report with `completed: false` and `failed` entries containing the app, error,
retry command and `logDirectory`. Later packages, web apps, and defaults are still attempted. An early AUR recipe requires an already installed
Yay; theme and app stages can install the catalog’s Yay provider. Update requires mise and
changes only the checkout and CLI. Both publish to `$HOME/.local/bin/luna`.

Completed steps remain after failure. Build/copy failures keep the previous CLI.
Logs live under `$LUNA_STATE_HOME_DIR/install-logs` (otherwise
`$XDG_STATE_HOME/luna/install-logs`, then `~/.local/state/luna/install-logs`).
Each private run directory contains `events.jsonl`, full command stdout/stderr files,
and `summary.json`. Build diagnostics shown to callers use bounded tails; full output
remains on disk. Bootstrap keeps a separate `bootstrap.log`, including CLI handoff.
Subprocess output can contain private information; logs are restricted to the user.

Declared app processes receive a five-second warning, SIGTERM, then SIGKILL after
three seconds if still running. Only matching executables owned by the current user
are targeted; PID identity is rechecked. An app hosting setup cannot be closed: run
from a separate terminal. `closeApps: false` leaves process/profile checks to hooks.

Mise tools use global selections and refreshed shims, including already installed
versions. Managed Bash/Zsh startup blocks activate Mise in new interactive shells.
Zsh data-root defaults are set in `.zshenv` before app includes can activate Mise;
`ZDOTDIR` is honored when supplied.
Explicit runtime Mise data paths and personal startup content are retained.
The final defaults stage selects the configured login shell only when the account
uses another shell; this takes effect on the next login. Sudo authentication is refreshed during long
self/app installs without repeatedly prompting.
Self errors include `INVALID_ENVIRONMENT`, `INVALID_ARGUMENT`, `INVALID_PATH`,
`INVALID_METADATA`, `INPUT_REQUIRED`, `COMMAND_FAILED`, and `IO_ERROR`.

## Checks

```sh
bun run --cwd packages/luna-api check
bun run --cwd packages/luna-api test
bun run --cwd packages/luna-api build
```

## Default applications

`Luna.defaults.list(options?)`, `set(key, application, options?)`, and
`reset(keys?, options?)` inspect or change system defaults. Reset with no keys
reapplies the entire defaults manifest; selected keys restore only those entries.
Set changes active preferences without editing the manifest.

Options accept `repository`, `env`, `configFile`, and `onProgress`. The manifest
defaults to `installs/defaults.jsonc` in the checkout; relative explicit paths use
the caller's working directory. `shellsFile` overrides `/etc/shells` when needed.
Schema validation lives in `src/defaults/schema.ts`.

Keys are `terminal`, `shell`, exact MIME/URI-handler types, or `image/*`, `audio/*`,
and `video/*`. Desktop choices require an installed `.desktop` ID. Wildcards
expand only advertised MIME types; exact manifest entries override them, including
during a scoped wildcard reset. Shells use executable names or absolute paths;
changes require registration and take effect on the next login. Terminal desktop
entries require `TerminalEmulator` and `[X-]TerminalArgExec`, including an empty
execution argument when none is needed.

List returns `{key, value, current, available}` entries; `current` maps exact types
to active IDs or null, and uses `terminal`/`shell` for those roles. Set/reset return
`{applied}` with expanded types and the resolved login-shell path.

Preferences update generic, Hyprland, and active-desktop MIME/terminal files,
preserving unrelated keys, associations, comments, and symlink targets. Each file
is saved atomically and detected external edits return `CONFLICT`. Validation
precedes changes; a later write or shell-command failure can leave earlier changes
applied. Invalid manifests return `INVALID_METADATA`; unavailable choices and
unknown reset keys return `INVALID_ARGUMENT`. Source JSONC is never rewritten.

## Theme API

`Luna.theme` exposes `install(source, options?)`, `list(options?)`,
`current(options?)`, `path(name?, options?)`, `get(key?, options?)`,
`inspect(name, options?)`, `set(name, options?)`, `mode(mode?, options?)`,
`toggle(options?)`, `getConfigFile(options?)`, `hyprland(options?)`,
`applyT3code(options?)`, and `remove(names, options?)`. All return the usual API
response. Missing dotted keys and an unset current name return null.

Theme options accept `env`, `configFile`, `libraryDir`, and `wallpaperDir`.
Install also accepts `name` and `force`; remove accepts `dryRun`; T3 application
accepts an explicit `userdata` directory. `mode` accepts dark/light/toggle.
Validation uses the feature-owned Zod schemas in `src/theme/schema.ts`.

See [theme fields and storage](../../themes/DOCS.md). `set`, `mode`, and `toggle`
publish GTK3 colors, UI/monospace fonts, and control rounding from the selected
theme, then synchronize GSettings `color-scheme` and `gtk-theme`, without restarting apps. System mode
changes preserve the authored palette. Failed application attempts selection,
stylesheet, and preference recovery while preserving detected external edits.
Generated stylesheets and dconf preferences persist across app and session restarts.
Headless shells use a private D-Bus session
when no session address or runtime bus is supplied; setup installs `dbus` for this. Source JSONC stays intact; selection writes
normalize its owned document. Mutations can return `CONFLICT` for locks, external
edits, existing copies, or wallpaper filename conflicts.

## Menu API

`Luna.menu` provides `start`, `show`, `system`, `hide`, `toggle`, `stop`, and `status`.
Show/system/toggle start it when needed; start stays hidden. System opens the session
action list without executing an action. Options: `repository` selects
source QML; `env` replaces the environment. Otherwise QML comes from Luna's installed
menu config directory. Responses contain `{running, shellDirectory}`. Startup
resolves one theme snapshot; no files are watched. Missing QML returns `INVALID_PATH`;
missing Quickshell or failed IPC returns `COMMAND_FAILED`.
`Luna.menu.stayAwake(action?, options?)` returns `{enabled}` for `on`, `off`,
`toggle` (default), or `status`; invalid actions return `INVALID_ARGUMENT`.
On/toggle start a hidden menu when needed. Status/off leave a stopped menu stopped.
Inhibition survives hiding the menu and resets when its process stops.
See the [menu docs](../../src/luna-menu/DOCS.md).

## Wallpaper API

`Luna.wallpaper` provides `install(sources, options?)` (alias `add`),
`list(options?)`, `current(options?)`, `path(name?, options?)`,
`set(nameOrPath, options?)`, `random(options?)`, `remove(names, options?)`,
`get(key?, options?)`, `getConfigFile(options?)`, `configure(settings, options?)`,
`start`, `stop`, `restart`, `reload`, and `status`. Lifecycle methods accept
`options?` and return `{running, status, shellDirectory, configFile}`. Reload
leaves a stopped renderer stopped; restart performs a full stop/start. Start
preserves an existing instance.

Options accept `env`, `repository` for source QML, `configFile`, and `libraryDir`.
Explicit relative paths use the caller's working directory. The settings file
defaults to nonempty `LUNA_WALLPAPER_CONFIG`, then
`$LUNA_CONFIG_HOME_DIR/wallpaper.jsonc`, `$XDG_CONFIG_HOME/luna/wallpaper.jsonc`,
or `~/.config/luna/wallpaper.jsonc`. Installed QML lives in the corresponding
`wallpaper/` directory. The shared media library defaults to
`$LUNA_DATA_HOME_DIR/wallpapers`, `$XDG_DATA_HOME/luna/wallpapers`, or
`~/.local/share/luna/wallpapers`; theme imports use the same default.

`install` accepts one source or an array of local files, directories, and HTTP(S)
URLs. Options add `recursive` for nested directories and `name` to rename one
explicit file or URL. Imports copy media without selecting it; directory imports
skip unrelated files and links and flatten nested files. Content detection
requires `file`; URLs additionally require `curl`. URLs cannot contain credentials;
downloads allow at most ten HTTP(S) redirects and sixty seconds. A URL without a
filename receives a deterministic content-based name. Identical names and bytes
are idempotent; different bytes at one name return `CONFLICT`. Validation and
conflict checks cover the complete batch before publication; a later I/O failure
can leave earlier files installed. Linked library paths and source/library overlap
are rejected.

`install` and `list` return `{name, path, current}` entries; `current` is the saved
source path or null. `path()` returns the library directory; `path(name)` requires
an existing ordinary library file. `set` accepts an installed filename, an absolute
local path, or `""` to clear media. `random` selects an installed file, avoiding the
saved selection when alternatives exist. `remove` accepts installed filenames and
returns their absolute paths; `dryRun` validates without deleting. It validates the
complete batch and refuses selected media and, when the renderer is available,
playing media. Install/list/remove work without QML or Quickshell; install/list
still validate the saved settings to mark the current entry.

Reads parse JSONC with Bun and validate with the feature's Zod schema in
`src/wallpaper/schema.ts`. Missing files are created as `{}`; blank files and
omitted values use renderer defaults without rewriting source. `get` returns sparse
saved settings; missing dotted keys return null. Unknown fields are retained.
See [wallpaper settings and dependencies](../../src/luna-wallpaper/DOCS.md).

`set`, `random`, and `configure` validate, lock and atomically save the normalized
JSONC document; `configure` merges supplied groups. Each mutation
then explicitly reloads a running renderer and waits for media readiness. These
mutations require installed or source QML and Quickshell. Read operations do not.
Failed application restores the exact previous source and renderer settings when
no detected external edit would be overwritten. Conflicts return `CONFLICT`;
invalid documents return `INVALID_METADATA`, invalid patches `INVALID_ARGUMENT`,
missing QML `INVALID_PATH`, and failed renderer commands/media `COMMAND_FAILED`.
Direct file edits require `reload`; no files are watched.

## Screensaver API

`Luna.screensaver` exposes `start`, `show` (alias `open`), `showIdle`, `hide`, `stop`, `restart`,
`reload`, `status`, `get(key?)`, `getConfigFile`, and `configure(settings)`; all accept options.
Lifecycle results contain `{running, status, shellDirectory, configFile}`; status is stopped/hidden/visible.
Start preserves running instances; show starts when needed. Restart waits for stop; reload leaves stopped instances stopped.

Options: `env`, `configFile`, `repository` for source QML, and `launcher` (default `~/.local/bin/luna`).
Settings use explicit `configFile`, then nonempty `LUNA_SCREENSAVER_CONFIG`, then `screensaver.jsonc` under
`LUNA_CONFIG_HOME_DIR`, `$XDG_CONFIG_HOME/luna`, or `~/.config/luna`. Relative explicit paths use the working directory.
Reads need no renderer, parse JSONC with Bun/Zod, create missing files as `{}`, and return null for missing keys.
`idle_seconds` accepts integers 0–86400; omitted values default to 300 in the native idle monitor. Zero disables activation.
Locking and display power belong to Luna Lock.

`configure` validates, locks, saves atomically, and reloads a running shell; control and configuration require QML and Quickshell.
Failed application restores source and live settings when no detected external edit would be overwritten.
The shell receives settings, theme, and CLI-command snapshots; it reads no configuration files and watches none. Reload applies direct edits.
Manual and idle show requests check `hyprctl -j locked` when `HYPRLAND_INSTANCE_SIGNATURE` is set, hiding over a locked session.
See [screensaver setup and tests](../../src/luna-screensaver/DOCS.md).

## Lock API

`Luna.lock` provides `start`, `lock` (`open`), `lockIdle`, `stop`, `restart`,
`reload`, `status`, `get`, `getConfigFile`, `configure`, and `display`.
`LockOptions` accepts `env`, an explicit JSONC `configFile`, a source `repository`,
and the `launcher` used by idle/display events. Settings default to
`$LUNA_CONFIG_HOME_DIR/lock.jsonc` or the Luna folder under XDG config home.

Reads create missing files as `{}`, preserve author bytes, and return null for
missing keys. `idle_seconds` and `dpms_seconds` accept integers from 0 to 86400;
zero disables each timer independently. The shell defaults to 600 seconds for
automatic locking and 30 seconds for display power-off while locked.
`configure` validates, saves atomically, and explicitly reloads a running shell.
Failed application restores previous source only if no external edit intervened.
Direct edits need `reload`; no settings or QML file watchers run.

`start` stays idle. Manual locking waits for the compositor's secure acknowledgement;
stale `lockIdle` requests recheck native idle state. Stop/restart refuse while
acquiring or holding a lock. Native PAM authenticates the current user; there is
no API/CLI unlock operation or password transport. Display power uses Hyprland's
Lua dispatcher; off requests require a secure, natively idle lock. The shell
serializes off/wake requests so resumed input remains locked with displays awake.
See [Lock setup and checks](../../src/luna-lock/DOCS.md).

## Screenshot API

`Luna.screenshot.capture(mode?, options?)` saves a PNG and copies it to the Wayland
clipboard. Modes are `region` (default), `screen` (focused monitor), `window`
(the active window's visible rectangle), and `all` (combined desktop). Escape
returns `{cancelled: true, path: null}`; success returns `{cancelled: false, path}`.
Window capture includes overlapping content; it does not render hidden windows.

Install capture dependencies with `luna install luna-screenshot`. Screen/window
need Hyprland. Options accept `env`, `directory`, and `repository` for the menu
to dismiss. Directory selection is explicit `directory`, then `LUNA_SCREENSHOT_DIR`,
then `~/Pictures/Screenshots`; relative paths use the working directory and `~/`
expands through HOME. Files use local timestamps and unique suffixes, with exclusive
creation. No settings file is needed.

Only one capture runs per runtime directory. The menu closes before capture;
selection cancellation saves nothing and keeps the clipboard. Tool/capture failures
return `COMMAND_FAILED` and remove partial files. Clipboard failures retain the
completed image and include its path in the error. Busy captures return `CONFLICT`;
invalid modes/paths return `INVALID_ARGUMENT`/`INVALID_PATH`. Notifications are best
effort and do not affect success.

## App API

`Luna.apps.install(names?, options?)` installs missing apps and configures them.
`Luna.apps.configure(names?, options?)` runs configuration only. Omit names to
select all; names match directory IDs or package names. Installation returns `{ installed, failed, completed, logDirectory }`; configuration
returns selected IDs. Both preserve `apps/apps.jsonc` order, irrespective of argument order.
Options: `repository`, `env`, `onProgress`, and install-only `force` to rerun
installation/build hooks even for installed apps. Install also accepts `skipFailed`;
both operations accept `closeApps`. Run installation as a normal user.

See [app manifests and lifecycle](../../apps/DOCS.md) for hooks, Zsh aliases, exports, settings,
Git refs, build cleanup, and retry behavior. Invalid catalogs fail before package
or hook changes. Failed operations retain completed changes for a later retry.

## Web-app API

`Luna.webapp.install(name, url, options?)`, `list(options?)`,
`uninstall(name, options?)`, and `launch(name, options?)` manage desktop launchers.
Names are exact, nonblank display names (at most 100 UTF-8 bytes); URLs must use
HTTP(S), without credentials. Installing the same name updates its URL and icon.

Chromium and the configured `Luna` profile must exist before install/launch
(`luna install chromium`). Launch uses `--app=URL --profile-directory=Luna`,
without browser tabs/address bar; window decorations depend on the compositor.
Installation does not open Chromium or change its profile. Uninstall removes
only the launcher, metadata, and downloaded icon; browser data and unrelated apps remain.

Installation downloads the largest available icon from the site's manifest,
touch icons, or favicons, preserving its original bytes and resolution. SVGs
take priority because they scale without losing detail. Discovery uses HTTP(S)
only, checking up to 24 icon URLs with a 15-second total deadline, five redirects
per request, and an 8 MiB limit per icon. Unavailable icons use the generic web
icon; installation still succeeds. Reinstall existing web apps to refresh their icons.

Options accept `env`, `dataDir`, `applicationsDir`, `launcher`, `profileRoot`, and
`chromium`. Defaults are `$LUNA_DATA_HOME_DIR/webapps` (otherwise
`$XDG_DATA_HOME/luna/webapps`), `$XDG_DATA_HOME/applications`,
`$HOME/.local/bin/luna`, and `$CHROME_USER_DATA_DIR` (otherwise
`$CHROME_CONFIG_HOME/chromium`, then `$XDG_CONFIG_HOME/chromium`). XDG roots
fall back under HOME. Desktop entries invoke the installed Luna executable and
use the downloaded site icon. Launchers retain resolved API paths and browser
selection independently of the desktop environment. Browser profile and export paths must not overlap;
linked export paths are rejected. Per-app locks serialize writes. A late I/O
failure can leave metadata without its launcher; reinstall repairs it.

## Notification API

`Luna.notify` exposes `start`, `stop`, `restart`, `status`, `focus`, and `dismiss`.
Lifecycle operations accept `NotifyOptions` (`repository` for source QML,
`configFile` for explicit JSONC, `env` for child processes and paths) and return
`{running, shellDirectory, configFile}` in the standard response.
`get(key?, options)` reads sparse settings with `null` for missing keys;
`getConfigFile(options)` locates the source without requiring Quickshell.
Start confirms D-Bus ownership; another provider returns `CONFLICT` without being
stopped. Missing QML returns `INVALID_PATH`; launch and bus errors return
`COMMAND_FAILED`. Focus/dismiss leave a stopped provider stopped. Restart validates settings and resolves the theme/icons before replacing an
instance. JSONC is parsed with Bun and validated by the notification API; defaults
are merged only in memory. Unknown source fields and comments are left intact. See [toast controls](../../src/luna-notify/DOCS.md).
