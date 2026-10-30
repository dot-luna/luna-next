# Zsh

Luna Next's managed Zsh startup, completions, history, shell tools, and packaged
plugins. Requires Zsh; optional tools and plugins are listed in [DOCS.md](DOCS.md).

```sh
luna configure zsh
exec zsh
```

Configuration replaces `~/.zshrc` (or `$ZDOTDIR/.zshrc`) and installs modules under
`$XDG_CONFIG_HOME/luna-next/zsh`, defaulting to `~/.config/luna-next/zsh`.
