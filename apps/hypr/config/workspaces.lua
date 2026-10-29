-- Divide numbered workspaces into contiguous ranges in physical monitor order.
-- Reconcile after layout events settle so hotplug sees final positions and outputs.

-- Keep one assignment rule per workspace/output pair for reuse after reconnects.
local rules = {}

-- Replace temporary empty workspaces above 10 with the monitor's assigned starting workspace.
-- Keep the user's focused window or monitor and pointer position after those switches.
local function repair_overflow(monitors, first_workspaces)
    local pending = {}
    for _, monitor in ipairs(monitors) do
        local current = monitor.active_workspace

        -- A new display can open workspace 11 before its numbered range is assigned.
        -- Repair only empty, ordinary numbered workspaces that are not persistent.
        -- Leave populated or renamed workspaces, and monitors showing a special overlay, alone.
        if first_workspaces[monitor.name] and not monitor.active_special_workspace and current
            and current.id > 10 and current.name == tostring(current.id)
            and current.is_empty and not current.is_persistent then
            table.insert(pending, first_workspaces[monitor.name])
        end
    end
    if #pending == 0 then
        return
    end

    -- Workspace switches may change keyboard focus and warp the pointer; save both first.
    local focused_monitor = hl.get_active_monitor()
    local focused_window = hl.get_active_window()
    local cursor = hl.get_cursor_pos()

    -- Normal switching creates missing targets and removes empty overflow workspaces.
    for _, workspace in ipairs(pending) do
        hl.dispatch(hl.dsp.focus({ workspace = workspace }))
    end

    -- Return to the original window if it still exists; otherwise restore the original monitor.
    local active_window = hl.get_active_window()
    local active_monitor = hl.get_active_monitor()
    if focused_window and focused_window.mapped then
        if not active_window or active_window.address ~= focused_window.address then
            hl.dispatch(hl.dsp.focus({ window = focused_window }))
        end
    elseif focused_monitor and (not active_monitor or active_monitor.name ~= focused_monitor.name) then
        hl.dispatch(hl.dsp.focus({ monitor = focused_monitor }))
    end

    -- Undo any pointer warp caused by repairing workspaces or restoring focus.
    local position = hl.get_cursor_pos()
    if cursor and position and (cursor.x ~= position.x or cursor.y ~= position.y) then
        hl.dispatch(hl.dsp.cursor.move({ x = cursor.x, y = cursor.y }))
    end
end

-- Assign ranges and move existing workspaces; return each monitor's first workspace
-- so overflow repair uses the same assignments without recalculating them.
local function assign_workspaces(monitors)
    -- Disable old assignments before installing replacements. Reuse rule handles
    -- when returning to a prior arrangement instead of accumulating duplicate rules.
    for _, rule in pairs(rules) do
        rule:set_enabled(false)
    end

    -- Map each global workspace number to its output; these are ten shared workspaces,
    -- not ten workspaces per monitor. Record each output's starting workspace as well.
    local targets = {}
    local first_workspaces = {}
    local workspace = 1

    -- Split evenly, giving any remainder to the first monitors in physical order.
    -- Two outputs get 1–5 and 6–10; three get 1–4, 5–7, and 8–10.
    for index, monitor in ipairs(monitors) do
        local count = math.floor(10 / #monitors) + (index <= 10 % #monitors and 1 or 0)
        if count > 0 then
            first_workspaces[monitor.name] = workspace
        end
        for offset = 1, count do
            local key = workspace .. ":" .. monitor.name
            if rules[key] then
                rules[key]:set_enabled(true)
            else
                rules[key] = hl.workspace_rule({ workspace = tostring(workspace), monitor = monitor.name })
            end
            targets[workspace] = monitor.name
            workspace = workspace + 1
        end
    end

    -- Rules route future workspace creation; move existing 1–10 workspaces with their windows.
    -- Workspaces outside that set have no target here and keep their current placement.
    for _, current in ipairs(hl.get_workspaces()) do
        local target = targets[current.id]
        if target and current.monitor and current.monitor.name ~= target then
            hl.dispatch(hl.dsp.workspace.move({ workspace = current.id, monitor = target }))
        end
    end

    return first_workspaces
end

-- Remember the last monitor order and its starting workspaces between display events.
local previous = ""
local first_workspaces = {}

-- Reassign only when the monitor order changes, then repair any temporary overflow.
local function apply()
    local monitors = {}

    -- A mirrored output shares another display's content and does not need its own range.
    for _, monitor in ipairs(hl.get_monitors()) do
        if not monitor.is_mirror then
            table.insert(monitors, monitor)
        end
    end

    -- Order left to right, then top to bottom when x matches; names break exact ties.
    table.sort(monitors, function(a, b)
        if a.x ~= b.x then
            return a.x < b.x
        end
        if a.y ~= b.y then
            return a.y < b.y
        end
        return a.name < b.name
    end)
    if #monitors == 0 then
        return
    end

    -- Moving outputs without changing their order does not change workspace ownership.
    -- Compare ordered names so ordinary layout events avoid rewriting identical rules.
    local names = {}
    for _, monitor in ipairs(monitors) do
        table.insert(names, monitor.name)
    end
    local signature = table.concat(names, "\n")
    if signature ~= previous then
        first_workspaces = assign_workspaces(monitors)
        previous = signature
    end

    -- Also repair when the order is unchanged: a quick disconnect/reconnect can
    -- leave a temporary workspace even though the same monitors are back in place.
    repair_overflow(monitors, first_workspaces)
end

local pending = false

-- Coalesce startup/hotplug bursts into one update 250 ms after the first event.
-- Later events share the pending timer; its callback reads the latest monitor state.
local function schedule()
    -- Config verification has no outputs or running event loop for a timer.
    if pending or #hl.get_monitors() == 0 then
        return
    end
    pending = true
    hl.timer(function()
        pending = false
        apply()
    end, { timeout = 250, type = "oneshot" })
end

-- Apply these assignments after startup/reload and when displays connect, disconnect, or move.
for _, event in ipairs({ "hyprland.start", "config.reloaded", "monitor.added", "monitor.removed", "monitor.layout_changed" }) do
    hl.on(event, schedule)
end
