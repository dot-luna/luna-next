local home = assert(os.getenv("HOME"), "HOME is required")

-- Luna resolves and validates the whole appearance, including defaults when no theme is selected.
local executable = "'" .. (home .. "/.local/bin/luna"):gsub("'", "'\\''") .. "'"
local pipe = assert(io.popen(executable .. " theme hyprland", "r"))
local source = pipe:read("*a")
-- Hyprland can reap subprocesses before pclose; validate the returned data instead.
pipe:close()
assert(source and source:match("^return {"), "Cannot resolve Luna theme; run luna theme get")
local settings = assert(load(source, "Luna theme appearance", "t", {}))()
assert(type(settings) == "table", "Luna theme appearance must be a table")
hl.config(settings)
return settings
