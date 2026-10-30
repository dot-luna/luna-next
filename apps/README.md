# App configurations

Each `apps/<name>/app.conf` declares its config exports:

```hocon
package = "wallpaper"
config = "config"
exports = [
    {
        source: "wallpaper.conf",
        defaults: "luna-next/defaults/wallpaper.conf",
        target: "luna-next/wallpaper.conf",
        file_env: "LUNA_WALLPAPER_CONFIG"
    }
]
```

| Field | Meaning |
| --- | --- |
| `package` | Package name that automatically configures this app after installation; defaults to the app folder name. |
| `config` | Config directory relative to the app folder; defaults to `config`. |
| `command` | Optional builder argument arrays, e.g. `[["sh", "build.sh"]]`; runs from the app folder. |
| `exports` | Files or folders to install after building. |
| `exports[].source` | File or folder inside the staged config directory; `.` exports the whole directory. |
| `exports[].defaults` | Optional HOCON defaults file under `$XDG_CONFIG_HOME`; the target is recreated with an include of this file. File exports only. |
| `exports[].target` | Destination file or folder relative to the export's base directory. |
| `exports[].base` | `config` (default) for `$XDG_CONFIG_HOME`, normally `~/.config`; `home` for `$HOME`. |
| `exports[].directory_env` | Optional environment variable overriding the base directory before appending `target`. |
| `exports[].file_env` | Optional environment variable overriding the full destination path, for files or folders. Takes precedence over `directory_env`. |

Builders receive `$LUNA_APP_DIR` and write generated files into `$LUNA_CONFIG_OUTPUT`.
Empty environment overrides use the declared base/target. Relative override paths
resolve against the caller's working directory. Sources and overlapping exports
are protected from replacement.

Export a folder with `{ source: ".", target: "luna-next/hypr" }`.

```sh
luna configure luna-wallpaper
```

`luna setup` and matching package installs also run this stage. Exports replace
existing destination files, folders, or symlinks without backups. A folder export
replaces the whole folder, including obsolete files.

The Hyprland export also replaces its active Lua entry under `hypr/hyprland.lua`
(`HYPRLAND_CONFIG` overrides that path). Its session startup prepares wallpaper,
polkit, and the hidden application menu; Super+Space toggles the menu.

[Kitty](kitty/DOCS.md), [Zsh](zsh/DOCS.md), and [Starship](starship/DOCS.md) have
matching package entries in [`installs/`](../installs/README.md). To refresh their
configs without reinstalling packages:

```sh
luna configure kitty zsh starship
```

Kitty and Starship builders use `luna theme get --json`; install `luna` on `PATH`
before configuring them. Rerun their configuration after changing themes. Zsh's
startup export uses `base: "home"` and `directory_env: "ZDOTDIR"` for `.zshrc`.
