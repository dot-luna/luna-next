local events, rules, pending = {}, {}, nil
local monitors, workspaces = {}, {}
local active_monitor, active_window
local cursor = { x = 360, y = 220 }

local function monitor(name, x)
    local output = { name = name, x = x, y = 0 }
    table.insert(monitors, output)
    return output
end

local function workspace(output, id, options)
    options = options or {}
    local current = {
        id = id,
        name = options.name or tostring(id),
        monitor = output,
        is_empty = options.is_empty ~= false,
        is_persistent = options.is_persistent == true,
    }
    table.insert(workspaces, current)
    if options.active then output.active_workspace = current end
    return current
end

local function assignment(id)
    local target
    for _, rule in ipairs(rules) do
        if rule.enabled and rule.workspace == tostring(id) then
            assert(not target, "duplicate assignment")
            target = rule.monitor
        end
    end
    return target
end

local function get_workspace(id)
    for _, current in ipairs(workspaces) do
        if current.id == id then return current end
    end
end

local function get_monitor(selector)
    for _, output in ipairs(monitors) do
        if output == selector or output.name == selector then return output end
    end
    error("Unknown monitor")
end

local function show_workspace(current)
    local output = current.monitor
    local previous = output.active_workspace
    output.active_workspace = current
    active_monitor = output
    active_window = current.window
    cursor = { x = output.x + 960, y = 540 }

    -- Hyprland removes an empty, nonpersistent workspace after switching away.
    if previous and previous ~= current and previous.is_empty and not previous.is_persistent then
        for index, candidate in ipairs(workspaces) do
            if candidate == previous then table.remove(workspaces, index); break end
        end
    end
end

hl = {
    get_monitors = function() return monitors end,
    get_workspaces = function() return workspaces end,
    get_active_monitor = function() return active_monitor end,
    get_active_window = function() return active_window end,
    get_cursor_pos = function() return cursor end,
    on = function(event, callback) events[event] = callback end,
    timer = function(callback) pending = callback end,
    workspace_rule = function(spec)
        spec.enabled = true
        function spec:set_enabled(value) self.enabled = value end
        table.insert(rules, spec)
        return spec
    end,
    dsp = {
        workspace = { move = function(options) return { move = options } end },
        focus = function(options) return { focus = options } end,
        cursor = { move = function(options) return { cursor = options } end },
    },
    dispatch = function(action)
        if action.move then
            local current = assert(get_workspace(action.move.workspace))
            current.monitor = get_monitor(action.move.monitor)
        elseif action.cursor then
            cursor = { x = action.cursor.x, y = action.cursor.y }
        elseif action.focus.workspace then
            local id = action.focus.workspace
            local current = get_workspace(id)
            if not current then current = workspace(get_monitor(assignment(id)), id) end
            show_workspace(current)
        elseif action.focus.window then
            local window = action.focus.window
            show_workspace(window.workspace)
            active_window = window
        elseif action.focus.monitor then
            show_workspace(get_monitor(action.focus.monitor).active_workspace)
        else
            error("Unsupported dispatch")
        end
    end,
}

local function flush()
    if pending then
        local callback = pending
        pending = nil
        callback()
    end
end

local function update(event)
    events[event]()
    flush()
end

local function load_workspaces()
    local config_dir = arg[1]:match("^(.*)/[^/]+$")
    dofile(config_dir .. '/workspaces.lua')
end
