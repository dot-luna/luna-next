# Zsh configuration

`lnxt configure zsh` replaces the exported startup file and module folder without
backups. A nonempty `ZDOTDIR` selects the startup directory; otherwise it is
`HOME`. A nonempty `XDG_CONFIG_HOME` selects the module base; otherwise it is
`~/.config`. Start a new shell to load the result.

## Shell behavior

- Emacs bindings; Up/Down search the typed history prefix and navigate multiline input.
- History uses `$HISTFILE` or `~/.histfile`, retains 32,768 entries, appends on exit,
  and omits leading spaces and consecutive duplicates.
- `~/.local/bin` and an existing `$PNPM_HOME/bin` join `PATH` without duplicates.
  `PNPM_HOME` defaults to `${XDG_DATA_HOME:-$HOME/.local/share}/pnpm`.
- Interactive shells initialize completion without creating a `.zcompdump` file.

## Optional integrations

`lnxt install --main` installs the shell tools and packaged plugins below. When
configuring without package installation, missing tools are skipped.

| Tool | Behavior |
| --- | --- |
| mise | Activates in each interactive shell; configure generates fresh Zsh completion. Failed or unavailable generation skips that completion. |
| zoxide | Provides `cd` through `z`, and `cdi` through `zi`. |
| fzf | Ctrl+R history, Ctrl+T files, Alt+C directories; fd provides hidden-file searches, bat/eza provide previews. |
| eza | Adds `ll`, `la`, and `lt`; existing aliases/functions take precedence. |
| Starship | Initializes once with `$STARSHIP_CONFIG` or `${XDG_CONFIG_HOME:-$HOME/.config}/starship.toml`. Install its config with `lnxt configure starship`. |

Packaged `fzf-tab`, `zsh-autosuggestions`, `zsh-syntax-highlighting`, and
`zsh-completions` load from `/usr/share/zsh`. Plugins load at the first prompt,
with highlighting last. Existing tool hooks and plugin functions are reused.
Explicit fzf settings, including empty settings, take precedence.

## Checks

From the repository root:

```sh
for file in apps/zsh/config/zshrc apps/zsh/config/zsh/*; do zsh -n "$file" || exit; done
sh -n apps/zsh/src/build.sh
python3 -m unittest discover -s apps/zsh/tests -v
```

Tests use isolated temporary homes. Real Starship and packaged plugin checks skip
when their programs or packages are absent.
