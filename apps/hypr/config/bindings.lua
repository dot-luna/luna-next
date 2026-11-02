-- App shortcut inhibition does not disable these bindings; lock-screen protection remains.
local function bind(keys, action, description, options)
    options = options or {}
    options.non_consuming = false
    options.dont_inhibit = true
    options.description = description
    return hl.bind(keys, action, options)
end

return function(config_dir, appearance)
    for _, name in ipairs({ "apps", "windows", "workspaces", "display" }) do
        dofile(config_dir .. "/bindings/" .. name .. ".lua")(bind)
    end
    dofile(config_dir .. "/bindings/appearance.lua")(bind, appearance)
end
