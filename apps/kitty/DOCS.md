# Kitty configuration

`lnxt configure kitty` replaces `$XDG_CONFIG_HOME/kitty` (default
`~/.config/kitty`). `KITTY_CONFIG_DIRECTORY` overrides the whole destination
folder. Existing files inside that folder are replaced without backups.

The generated `generated/theme.conf` supplies terminal colors, ANSI colors,
selection, tabs, borders, and `fonts.mono` from `lnxt theme get --json`. With no
selected theme, Luna Next's defaults apply. A theme resolution error stops the
export before the installed configuration changes.

After selecting or editing a theme, run `lnxt configure kitty starship` again.
Restart Kitty to apply the configuration. Theme selection does not regenerate it.

The configuration keeps 14-point text, ligatures, a steady underline cursor,
padding of `5 5 1 5` points, and no window decorations. Remote control accepts
only the local per-process socket at
`$XDG_RUNTIME_DIR/luna-kitty-{kitty_pid}`; terminal-output requests stay disabled.

From the repository root:

```sh
python3 -m unittest discover -s apps/kitty/tests -v
```

Native parsing coverage uses Kitty when installed and does not open a window.
