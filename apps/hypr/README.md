# Hyprland

Hyprland Lua configuration for Luna Next: monitors, workspaces, input, appearance,
animations, shortcuts, and wallpaper startup.

Install the configuration:

```sh
lnxt configure hypr
```

Add this before personal settings in your Hyprland Lua config:

```lua
local config_home = os.getenv("XDG_CONFIG_HOME")
if not config_home or config_home == "" then
    config_home = os.getenv("HOME") .. "/.config"
end
dofile(config_home .. "/luna-next/hypr/hyprland.lua")
```

See [DOCS.md](DOCS.md) for shortcuts, dependencies, and checks.
