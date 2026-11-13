-- Load sibling modules from the physical entry, including when this file is a symlink.
local source = debug.getinfo(1, "S").source
assert(source:sub(1, 1) == "@", "Load Luna Next's Hyprland entry from a file")
local quoted = "'" .. source:sub(2):gsub("'", "'\\''") .. "'"
local pipe = assert(io.popen("readlink -f -- " .. quoted, "r"))
local path = pipe:read("*a")
-- Hyprland can reap subprocesses before pclose; use the resolved output.
pipe:close()
local config_dir = assert(path:gsub("\n$", ""):match("^(.*)/[^/]+$"),
    "Cannot locate Luna Next's Hyprland configuration")

-- Publish shared paths before any modules or external app fragments read them.
dofile(config_dir .. "/env.lua")(config_dir)

for _, name in ipairs({ "monitors", "workspaces", "input" }) do
    dofile(config_dir .. "/" .. name .. ".lua")
end
local appearance = dofile(config_dir .. "/appearance.lua")
dofile(config_dir .. "/rules.lua")()
for _, name in ipairs({ "animations", "autostart" }) do
    dofile(config_dir .. "/" .. name .. ".lua")
end
dofile(config_dir .. "/bindings.lua")(config_dir, appearance)

-- Apps export their Lua fragments into hypr.d/, outside the folder this app replaces.
dofile(config_dir .. "/fragments.lua")(os.getenv("LUNA_CONFIG_HOME_DIR") .. "/hypr.d")
