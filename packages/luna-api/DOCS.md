# Luna API

`Luna.info(options?)` reads the checkout's root `package.json` on every call.
`Luna.self.install(options?)` prepares shared prerequisites and Git configuration.
`Luna.self.update(options?)` updates the checkout and rebuilds/publishes only the CLI.

All operations return `{ succes: true, data }` or
`{ succes: false, err, errMessage }`. The `succes` spelling is the API contract.
The API does not print; self operations capture command output, returning failed
command diagnostics and optionally calling `onProgress(message)`.

## Self options and behavior

- `repository`: checkout path; overrides `LUNA_ROOT`, then the default
  `$HOME/.local/src/luna-next`. Relative paths use the caller's working directory.
- `env`: replaces the operation environment; defaults to `Bun.env`. HOME must be
  an absolute non-root home. The caller's environment and cwd remain unchanged.
- `ref`: branch, tag, or `latest` (remote default branch). Defaults to `latest`.
- `onProgress`: optional synchronous progress callback.

Self operations require an existing standalone Luna checkout and a normal Arch
Linux user with Git, pacman, Bash, and sudo available. Updates preserve local edits
and commits, use fast-forward pulls, and do not replace local tags.

Installation additionally accepts `fromBootstrap` to skip the checkout update,
system upgrade, and CLI build already performed by `install.sh`; package stages
still run. Order: validate, update checkout, `before_cli` packages, build/publish
CLI, Git configuration, `after_cli` packages and mise tools. Direct installation
upgrades system packages before installing dependencies.

Use `git: { name?, email? }` to override global identity values. Otherwise existing
values are retained. `requestGitIdentity(current)` may supply missing values;
the API itself never prompts. Git defaults use `master` and `nvim`, with Neovim
in the before-CLI dependencies. Unrelated global Git settings are retained.

Themes, apps, later packages, and web apps are empty installation stages.
`data.pending` lists them; `data.cliRebuilt` reports whether CLI publication ran.
An early AUR recipe requires an already installed yay. Update requires mise and
changes only the checkout and CLI. Both publish to `$HOME/.local/bin/luna`.

Completed steps remain after failure. Build/copy failures keep the previous CLI.
Self errors include `INVALID_ENVIRONMENT`, `INVALID_ARGUMENT`, `INVALID_PATH`,
`INVALID_METADATA`, `INPUT_REQUIRED`, `COMMAND_FAILED`, and `IO_ERROR`.

## Checks

```sh
bun run --cwd packages/luna-api check
bun run --cwd packages/luna-api test
bun run --cwd packages/luna-api build
```
