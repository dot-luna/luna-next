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
  and web apps. A direct invocation also upgrades system packages before
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
activate Mise automatically. Existing terminal sessions need restarting. Zsh
configuration also sets the account's default shell to Zsh when needed; log in
again for the new login shell.

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

## Apps and web apps

- `luna install [names...] [--force] [--install-dir PATH]`: install and configure
  selected apps; omit names for all. Match directory IDs, package names, or aliases.
- `luna configure [names...] [--install-dir PATH]`: configure without installing.
  `config` and `confi` are aliases. Apps always follow catalog order.
- `luna webapp install [name] [url]`: prompt for missing values in a terminal.
  JSON mode requires both values and never prompts.
- `luna webapp list`, `luna webapp launch <name>`,
  `luna webapp uninstall <name>`: manage apps by exact display name.

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
