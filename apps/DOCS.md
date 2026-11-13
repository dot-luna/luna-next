# App manifests

Apps can declare an optional `deps` array using the package objects shown in
[`installs/example.jsonc`](../installs/example.jsonc): `name`, `source`, and optional
`purpose` and mise `version`. Dependencies must be installed before the app and
its hooks. Omit `deps` when no additional packages are needed.

Use `deps` only for packages directly tied to the app, such as Zsh plugins.
General tools and editors belong in `installs/`, usually in
`later`; use an earlier stage when setup needs them.

App package names must be unique and absent from `installs/` and all app dependencies.
Apps can repeat dependencies declared by other apps or `installs/` when their
`source` and `version` agree; descriptive purposes can differ. Keep each app's
required dependencies in its manifest so selecting that app installs them.

Hooks run as the user with the app folder as their working directory and Luna's
environment available. A nonzero exit stops that app's operation; completed steps
are not automatically undone. Scripts must support repeated runs. Use a shebang
such as `#!/usr/bin/env bun` or `#!/usr/bin/env bash` and make the script executable.
An app can use hooks without exports when its scripts consume settings directly.

Git apps run `before_install → clone/update selected ref → before_build → build →
after_build → after_install`, then the configuration stages. Build stages are skipped
when no build is needed. Hooks still run from the app folder; scripts locate the app's
clone, disposable build workspace, and installation under `LUNA_GIT_APP_CLONE_DIR`,
`LUNA_GIT_APP_BUILD_DIR`, and `LUNA_GIT_APP_INSTALL_DIR`, each with the app name appended.
`LUNA_PACKAGE_VERSION` contains the selected concrete ref, never `latest`.
The installer must serialize the whole build sequence per app. A failure stops later
stages; scripts must clean up temporary system dependencies within the build stage.

Use `luna install [names...]` to install/configure, or `luna configure [names...]`
for configuration only. Names can be directory IDs or package names. Selection
always follows `apps.jsonc` order; omitted names select all. `--force` reruns
installation/build hooks. Pacman/AUR packages are checked with `pacman -Qq`;
mise tools resolve requested versions/aliases against installed versions. Dependencies run before app hooks.
Mise selections are activated globally even when the requested version is already
installed. Bash/Zsh startup initialization and shims are reconciled during tool setup.
An absent Yay is installed through the indexed provider, which must precede AUR apps.

Optional `processes` lists executable basenames that must close before app work.
Only the current user's processes are targeted, with a five-second warning and
SIGTERM/SIGKILL escalation. The installer never terminates its own hosting app;
retry from another terminal. `--no-close-apps` disables this behavior.
`--skip-failed` retains individual app errors/logs and attempts the remaining apps.

## Shell aliases

`alias` declares Zsh shortcuts, such as `ff` for Fastfetch. Configuring an app with
aliases writes `$LUNA_CONFIG_HOME_DIR/aliases/<id>.zsh`; Luna's Zsh startup loads
these files. A name such as `"ff"` runs the package `name`; `[name, argv]` runs a
fixed command, such as `["menu", ["luna", "menu"]]` for Luna Menu. Arguments typed
after an alias are appended to its command.

Existing personal aliases/functions are kept, and settings later in the user's
`.zshrc` can override Luna's aliases. After changing aliases, reconfigure the app
and Zsh (for example, `luna configure fastfetch zsh`), then open a new terminal.

## Exports and personal settings

Exports replace declared files/folders under `$LUNA_CONFIG_HOME_DIR` completely,
without backups; exclusions omit source entries. Unrelated paths remain. Native
`user_config` destinations use the first available candidate (`$VAR`, `${VAR}`,
`~/`, or trusted `!command`). Missing variables skip a candidate.

`include` prepends a distinct managed block per source to shell, Lua, Kitty or CSS
configuration, retaining personal overrides. `merge` adds missing defaults to
JSON/JSONC, TOML, YAML, btop assignments and bat flags; existing user values win,
including nulls and arrays. Structured merges normalize formatting/comments.
App-native formats remain native; Luna manifests use JSONC with API-owned Zod
validation. Export parent links and paths escaping source trees are rejected.
Publication is atomic per export; multiple exports and hooks can be partially
applied after failure. Fix errors and rerun configuration.

## Git builds and retries

An explicit `version` selects a branch/tag; branches win name collisions.
`latest` chooses the highest matching semantic release tag, optionally including
prereleases; no eligible tag falls back to the default branch unless a tag pattern
was specified. Null/omitted versions follow the remote default branch.

Managed clones stay clean and detached. Build hooks use a disposable copy unless
`before_build` explicitly prepares their workspace. Generic workspaces are removed
after successful configuration; app-specific hooks own their cleanup. Failed builds
retain diagnostics/workspaces. Dirty clones and personal detached commits are
protected. Unchanged revisions skip builds; configuration still reruns. Use
`--force` to rebuild missing artifacts. Successfully installed packages/revisions
remain after later failures. Root directories for clone, build, install,
configuration and state must be separate and outside the checkout.
