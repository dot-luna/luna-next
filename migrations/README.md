# Release migrations

Add one executable `v<from>-v<to>.<extension>` script for each version change,
for example `v0.0.2-v0.0.3.ts`. Use stable `x.y.z` versions matching the root
`package.json`. Keep a single forward chain, including no-op scripts for releases
without system changes. Keep published scripts so users can skip releases.

```ts
#!/usr/bin/env bun
import { Luna } from "../packages/luna-api/src/index.ts";

const result = await Luna.apps.install(["example"]);
if (!result.succes) throw new Error(result.errMessage);
```

Use the actual app ID and API options for the change. Mark scripts executable with
`chmod +x`. The shebang selects the interpreter; `.sh` scripts work too.

`luna self update` validates the full chain, builds the new CLI, runs pending scripts
in order, then publishes the CLI. Scripts run as the user from the updated checkout,
with `LUNA_ROOT`, `LUNA_MIGRATION_FROM_VERSION`, and `LUNA_MIGRATION_TO_VERSION` set.
The newly built `target/luna` and Bun are on PATH. Prefer the checkout's shared APIs
for app operations. Scripts may use sudo when system package changes require it.

Exit nonzero on failure. Completed steps stay recorded; the failed script runs again
on the next update. Make each script safe after partial execution, including when it
finished but its completion could not be saved. Limit deletion to explicitly owned
paths and validate them before changing files. Never edit published scripts to add
new work; add another version step.

When a migration changes an app's configuration or runtime files, also apply the
change to its running instance. Use its configure hook or reload/restart API and
propagate failures. Keep stopped apps stopped unless the release requires starting
them. Reload Hyprland with `hyprctl reload` when changing its files inside a
Hyprland session. Explain each refresh beside the command; refresh only affected apps.

Fresh installs record their version after complete setup and skip historical scripts.
State is stored in `$LUNA_STATE_HOME_DIR/migrations.jsonc`, otherwise
`${XDG_STATE_HOME:-$HOME/.local/state}/luna/migrations.jsonc`. Do not edit it to skip
failed work. Downgrades and incomplete or ambiguous chains are rejected.

The v0.0.2 updater hands off through the fetched CLI build before publication, so
its first update also runs migrations. Ordinary CLI builds do not run migrations.

Checks: `bun test packages/luna-api/tests/migrations.test.ts`.

## v0.0.3

Installs the WhatsApp web app and removes Whatly's managed installation, source and
build files, desktop assets, startup entry, settings, profiles, sessions, and caches.
Named profiles and configured storage directories are included. Dependencies are
removed only when retained Luna install logs and pacman history show they were newly
installed for Whatly and no remaining Luna recipe or installed package requires or
optionally uses them. Pre-existing packages and packages with unknown ownership stay
installed. Unrelated files and existing Chromium data stay in place. WhatsApp Web needs its own
sign-in. Run `luna webapp launch WhatsApp` after updating.

## v0.0.4

Reconfigures Luna Notify to advertise separate browser-origin metadata, then
reconfigures Chromium to build and install Better WhatsApp Web and Luna Browser Links
in the Luna profile. Chromium closes during configuration; save drafts before updating.
Profiles, sessions and extension preferences remain. A running Luna notification
provider restarts; a stopped provider stays stopped. Repeating the migration is safe.

## v0.0.5

Fixes Chromium configuration after shutdown leaves stale singleton links. Only
same-host, current-user links with an exited owner and no listening socket are
removed. Active or ambiguous profiles still block configuration. No installed
files need changing for users who completed v0.0.4. A failed v0.0.4 migration runs
again with the corrected hook before this no-op version step.
The CLI now reports its build version independently of the fetched checkout.
Update failures print the full retry command and retain completed migration steps.

## v0.0.6

Installs the menu's clipboard dependencies and Noto Color Emoji, refreshes its QML,
then reconfigures Hyprland for Super+V, Super+. and clipboard capture at login. Starts capture when updating
inside Wayland. Reload Hyprland or log in again to load the shortcut. Clipboard
history is retained. The refreshed menu also fixes application icons after installation,
and Hyprland gives Calculator the same centered floating behavior as Bitwarden.

## v0.0.7

Refreshes menu clipboard rows and changes the emoji shortcut to Super+E.
Reconfigures only Luna Menu and Hyprland; clipboard history is retained.
Reload Hyprland or log in again to load the changed shortcut.

## v0.0.8

Shows only the thumbnail for clipboard images that render successfully. Refreshes
Luna Menu and Hyprland, restarts a running menu, and reloads the current Hyprland
session automatically. App hooks use a UTF-8 locale so Qt warnings cannot hide a
running menu from the refresh hook. Clipboard history is retained.

## v0.0.9

Installs Luna Bar, refreshes Hyprland's startup and Super+B binding, then reloads
the current Hyprland session and starts the bar immediately. Outside Hyprland,
the bar starts at the next login. Repeating the migration is safe.

## v0.0.10

Refreshes Hyprland without duplicating the native config's workspace swipe gesture.
Existing gesture bindings are retained, and a running Hyprland session reloads.

## v0.0.11

Refreshes only installed apps. Hyprland and Fastfetch get Super+Shift+F for the file
explorer, Super+Shift+Space to toggle the bar and Super+Shift+A for About, and a
running Hyprland session reloads. Luna Bar gains workspace icons, a clock with an
AD/BS calendar and world clocks, and `bar.jsonc` settings; a running bar restarts.
GTK styling is regenerated with native rounded controls. T3 Code applies Luna's
theme without closing. Zen and Chromium close while they are reconfigured: Zen
themes its popups and built-in pages, and Chromium removes Better WhatsApp Web and
sends only links clicked in installed web apps to the default browser. Apps newly
enabled by default are not installed on existing systems. Repeating it is safe.

## v0.0.12

Refreshes Luna Bar only when installed, adding quick controls, a tray dropdown and
the hidden-bar space fix. Installs brightnessctl, libpulse and Blueman for brightness,
active audio routing and Bluetooth pairing. Replaces the owned bar settings and QML;
a running bar restarts, and a stopped bar stays stopped. Repeating it is safe.
