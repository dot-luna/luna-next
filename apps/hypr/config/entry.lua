local config_home = os.getenv("XDG_CONFIG_HOME")
if not config_home or config_home == "" then
    config_home = os.getenv("HOME") .. "/.config"
end
dofile(config_home .. "/luna-next/hypr/hyprland.lua")
