# CLI usage

`luna` shows project information; `-v` prints the version. `--json` returns the
API response unchanged and suppresses progress and identity prompts. Success
exits with 0, operation failures with 1, and argument errors with 2.

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
  rebuild/publish the CLI, configure Git, then install `after_cli` packages and
  the mise list. A direct invocation also upgrades system packages before
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

Setup currently stops after shared prerequisites and Git configuration. Themes,
apps, `later` packages, and web apps are empty stages, reported as pending.
Early AUR recipes require an existing yay because app installation is deferred.

Build failures preserve the installed CLI. Completed checkout updates, packages,
and settings remain after later failures; fix the error and rerun setup.

## Checks

From the repository root:

```sh
bun run check
bun test __tests__ packages/luna-api/tests src/luna-cli/tests
bun run --cwd src/luna-cli build
```
