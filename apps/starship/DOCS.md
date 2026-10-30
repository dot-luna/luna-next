# Starship configuration

`luna configure starship` replaces `$XDG_CONFIG_HOME/starship.toml` (default
`~/.config/starship.toml`). `STARSHIP_CONFIG` overrides the complete file path.
The destination is replaced without a backup.

The native `luna_next` palette maps named ANSI colors, including bright variants,
to the semantic colors returned by `luna theme get --json`. The prompt keeps its
bracketed modules, two-component directory truncation, `…/` truncation symbol,
cyan repository root, and 200 ms command timeout. The terminal supplies its font;
the [Kitty configuration](../kitty/README.md) uses the theme's `fonts.mono`.

After selecting or editing a theme, run `luna configure kitty starship` again.
The next prompt reads the generated file. Theme selection does not regenerate it;
a theme resolution error leaves the installed configuration untouched.

The [Zsh configuration](../zsh/README.md) initializes Starship and selects this
file, including when `XDG_CONFIG_HOME` changes. For another shell, point
`STARSHIP_CONFIG` at the exported path and use Starship's initialization for that
shell.

From the repository root:

```sh
python3 -m unittest discover -s apps/starship/tests -v
```

Tests parse the generated TOML with Python 3.11 or newer and check native prompt
colors when Starship is installed. They use temporary configuration directories.
