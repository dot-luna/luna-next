# Luna API

`Luna.info(options?)` reads the checkout's root `package.json` on every call.
`Luna.self.install(options?)` installs prerequisites, Git configuration, themes, apps, later packages, and web apps.
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
- `skipFailed`: continue after individual app/web-app failures (default false).
- `closeApps`: close declared app processes before installation/configuration (default true).

Self operations require an existing standalone Luna checkout and a normal Arch
Linux user with Git, pacman, Bash, and sudo available. Updates preserve local edits
and commits, use fast-forward pulls, and do not replace local tags.

Installation additionally accepts `fromBootstrap` to skip the checkout update,
system upgrade, and CLI build already performed by `install.sh`; package stages
still run. Order: validate, update checkout, `before_cli` packages, build/publish
CLI, Git configuration, `after_cli` packages/mise tools, bundled themes and their
packages, apps in catalog order, later packages, then web apps. Direct installation
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
retry command and `logDirectory`. Later packages and web apps are still attempted. An early AUR recipe requires an already installed
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
Explicit runtime Mise data paths and personal startup content are retained. Zsh's
app hook selects Zsh as the login shell only when the account uses another shell;
this takes effect on the next login. Sudo authentication is refreshed during long
self/app installs without repeatedly prompting.
Self errors include `INVALID_ENVIRONMENT`, `INVALID_ARGUMENT`, `INVALID_PATH`,
`INVALID_METADATA`, `INPUT_REQUIRED`, `COMMAND_FAILED`, and `IO_ERROR`.

## Checks

```sh
bun run --cwd packages/luna-api check
bun run --cwd packages/luna-api test
bun run --cwd packages/luna-api build
```

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

See [theme fields and storage](../../themes/DOCS.md). Selection changes apply
GSettings but do not restart apps. Headless shells use a private D-Bus session
when no session address or runtime bus is supplied; setup installs `dbus` for this. Source JSONC stays intact; selection writes
normalize its owned document. Mutations can return `CONFLICT` for locks, external
edits, existing copies, or wallpaper filename conflicts.

## Menu API

`Luna.menu` provides `start`, `show`, `hide`, `toggle`, `stop`, and `status`.
Show/toggle start it when needed; start stays hidden. Options: `repository` selects
source QML; `env` replaces the environment. Otherwise QML comes from Luna's installed
menu config directory. Responses contain `{running, shellDirectory}`. Startup
resolves one theme snapshot; no files are watched. Missing QML returns `INVALID_PATH`;
missing Quickshell or failed IPC returns `COMMAND_FAILED`.
See the [menu docs](../../src/luna-menu/DOCS.md).

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
HTTP(S), without credentials. Installing the same name updates its URL.

Chromium and the configured `Luna` profile must exist before install/launch
(`luna install chromium`). Launch uses `--app=URL --profile-directory=Luna`,
without browser tabs/address bar; window decorations depend on the compositor.
Installation does not open Chromium or change its profile. Uninstall removes
only the launcher and metadata; browser data and unrelated apps remain.

Options accept `env`, `dataDir`, `applicationsDir`, `launcher`, `profileRoot`, and
`chromium`. Defaults are `$LUNA_DATA_HOME_DIR/webapps` (otherwise
`$XDG_DATA_HOME/luna/webapps`), `$XDG_DATA_HOME/applications`,
`$HOME/.local/bin/luna`, and `$CHROME_USER_DATA_DIR` (otherwise
`$CHROME_CONFIG_HOME/chromium`, then `$XDG_CONFIG_HOME/chromium`). XDG roots
fall back under HOME. Desktop entries invoke the installed Luna executable and
use a generic Chromium icon. Launchers retain resolved API paths and browser
selection independently of the desktop environment. Browser profile and export paths must not overlap;
linked export paths are rejected. Per-app locks serialize writes. A late I/O
failure can leave metadata without its launcher; reinstall repairs it.
