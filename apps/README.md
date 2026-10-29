# App configurations

Each `apps/<name>/app.conf` declares its config files:

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
| `exports` | Files to publish after building. |
| `exports[].source` | File path inside the staged config directory. |
| `exports[].defaults` | Optional managed defaults path under `$XDG_CONFIG_HOME`. Refreshed each run; missing user configs include it as HOCON. |
| `exports[].target` | Destination under `$XDG_CONFIG_HOME`, default `~/.config`. |
| `exports[].file_env` | Optional environment variable overriding the full destination path. |

Builders receive `$LUNA_APP_DIR` and write generated files into `$LUNA_CONFIG_OUTPUT`.

```sh
lnxt configure luna-wallpaper
```

`lnxt setup` and matching package installs also run this stage. Existing user
files and symlinks are kept; managed defaults are refreshed.
