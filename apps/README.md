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
| `exports[].target` | Destination file or folder under `$XDG_CONFIG_HOME`, default `~/.config`. |
| `exports[].file_env` | Optional environment variable overriding the full destination path. |

Builders receive `$LUNA_APP_DIR` and write generated files into `$LUNA_CONFIG_OUTPUT`.

Export a folder with `{ source: ".", target: "luna-next/hypr" }`.

```sh
lnxt configure luna-wallpaper
```

`lnxt setup` and matching package installs also run this stage. Exports replace
existing destination files, folders, or symlinks without backups. A folder export
replaces the whole folder, including obsolete files.
