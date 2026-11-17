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
