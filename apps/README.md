# App configurations

Custom default configuration files for Luna's preinstalled apps.
Each app keeps its configuration in its own folder:

```text
<app>/
├── config/        # Default configuration files
├── scripts/       # Optional lifecycle scripts
└── app.jsonc      # Declares which files to copy and where
```

The [`apps.jsonc`](apps.jsonc) index lists each app’s `app.jsonc` JSONC manifest in configuration order.

See [`app.example.jsonc`](app.example.jsonc) for a complete manifest example.

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

Hook execution is the manifest design; installer support will be added separately.
