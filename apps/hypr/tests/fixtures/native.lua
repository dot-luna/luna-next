local events, bindings, combinations, calls, commands, timers = {}, {}, {}, {}, {}, {}

local function action(kind)
    return function(options) return { kind = kind, options = options } end
end

hl = {
    config = function(settings) calls[#calls + 1] = settings end,
    monitor = function(settings) calls.monitor = settings end,
    window_rule = function() end,
    layer_rule = function() end,
    gesture = function() end,
    curve = function() end,
    animation = function() end,
    get_monitors = function() return {} end,
    get_windows = function() return {} end,
    on = function(event, callback)
        events[event] = events[event] or {}
        table.insert(events[event], callback)
    end,
    timer = function(callback)
        local timer = { callback = callback, enabled = true }
        function timer:set_enabled(enabled) self.enabled = enabled end
        timers[#timers + 1] = timer
        return timer
    end,
    bind = function(keys, dispatcher, options)
        assert(options.non_consuming == false, keys .. " must consume its input")
        assert(options.dont_inhibit == true, keys .. " must bypass app shortcut inhibitors")
        assert(not options.locked, keys .. " must respect the lock screen")
        assert(type(options.description) == "string" and options.description:match("%S"),
            keys .. " needs a description")
        assert(not bindings[keys], "duplicate shortcut: " .. keys)
        local parts = {}
        for part in keys:gmatch("[^+]+") do
            parts[#parts + 1] = part:gsub("%s+", ""):lower()
        end
        table.sort(parts)
        local canonical = table.concat(parts, "+")
        assert(not combinations[canonical], "duplicate key combination: " .. keys)
        combinations[canonical] = true
        bindings[keys] = { dispatcher = dispatcher, options = options }
    end,
    dispatch = function(dispatcher) commands[#commands + 1] = dispatcher end,
    dsp = {
        exec_cmd = action("exec"),
        focus = action("focus"),
        layout = action("layout"),
        window = {},
        group = {},
        workspace = { toggle_special = action("special") },
    },
}
for _, name in ipairs({ "close", "move", "fullscreen", "fullscreen_state", "float", "pin",
    "swap", "resize", "drag", "cycle_next", "bring_to_top", "pseudo" }) do
    hl.dsp.window[name] = action(name)
end
for _, name in ipairs({ "toggle", "next", "prev", "active" }) do
    hl.dsp.group[name] = action(name)
end

local function fire(event)
    for _, callback in ipairs(events[event] or {}) do callback() end
end
