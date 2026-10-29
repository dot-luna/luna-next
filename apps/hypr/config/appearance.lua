hl.config({
    general = {
        gaps_in = 5,
        gaps_out = 5,
        border_size = 1,
        col = { active_border = "#7aa2f7", inactive_border = "#414868" },
    },
    decoration = {
        rounding = 0,
        active_opacity = 0.9,
        inactive_opacity = 0.85,
        fullscreen_opacity = 1,
        blur = { enabled = true, size = 10, passes = 3 },
        shadow = { enabled = true, range = 12, render_power = 3, color = "#13141caa" },
    },
})

local home = assert(os.getenv("HOME"), "HOME is required")
local config_home = os.getenv("XDG_CONFIG_HOME")
if not config_home or config_home == "" then config_home = home .. "/.config" end
local selection = config_home .. "/luna-next/theme.conf"
local file, failure, code = io.open(selection, "r")
if not file then
    assert(code == 2, "Cannot read Luna Next theme: " .. tostring(failure))
    return
end
file:close()

-- The CLI resolves HOCON and validates shared appearance before translating it to Lua.
local executable = "'" .. (home .. "/.local/bin/lnxt"):gsub("'", "'\\''") .. "'"
local pipe = assert(io.popen(executable .. " theme hyprland", "r"))
local source = pipe:read("*a")
-- Hyprland can reap subprocesses before pclose; validate the returned data instead.
pipe:close()
assert(source and source:match("^return {"), "Cannot resolve Luna Next theme; run lnxt theme get")
local settings = assert(load(source, "Luna Next theme appearance", "t", {}))()
assert(type(settings) == "table", "Luna Next theme appearance must be a table")
hl.config(settings)
