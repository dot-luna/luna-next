-- Loaded by bindings.lua, which supplies the shared shortcut-registration helper.
return function(bind)
    -- Register these three shortcuts for each workspace: keys 1–9 select 1–9,
    -- and 0 selects 10. Workspace numbers are shared across all monitors.
    for workspace = 1, 10 do
        local key = tostring(workspace % 10)

        -- Super + number: switch to that workspace, focusing its monitor if needed.
        bind("SUPER + " .. key, hl.dsp.focus({ workspace = workspace }), "Switch to workspace " .. workspace)

        -- Super + Shift + number: move the focused window there and switch to it.
        bind("SUPER + SHIFT + " .. key, hl.dsp.window.move({ workspace = workspace, follow = true }),
            "Move window to workspace " .. workspace .. " and follow")

        -- Super + Shift + Alt + number: send the focused window there while
        -- keeping your current workspace and monitor in view.
        bind("SUPER + SHIFT + ALT + " .. key, hl.dsp.window.move({ workspace = workspace, follow = false }),
            "Move window silently to workspace " .. workspace)
    end

    -- Super + Tab: cycle to the next existing workspace on the current monitor.
    -- Wrap around at the end without creating a workspace or moving it between monitors.
    bind("SUPER + Tab", hl.dsp.focus({ workspace = "m+1" }), "Next workspace on this monitor")

    -- Super + Shift + Tab: cycle through this monitor's existing workspaces in reverse.
    bind("SUPER + SHIFT + Tab", hl.dsp.focus({ workspace = "m-1" }), "Previous workspace on this monitor")

    -- Hold Super and scroll down: go to the next existing workspace on this monitor.
    bind("SUPER + mouse_down", hl.dsp.focus({ workspace = "m+1" }), "Next workspace on this monitor")

    -- Hold Super and scroll up: go to the previous existing workspace on this monitor.
    bind("SUPER + mouse_up", hl.dsp.focus({ workspace = "m-1" }), "Previous workspace on this monitor")

    -- Super + Ctrl + Tab: return to the workspace last visited on this monitor,
    -- rather than choosing the previous workspace by number.
    bind("SUPER + CTRL + Tab", hl.dsp.focus({ workspace = "previous_per_monitor" }), "Return to former workspace")

    -- Ctrl + Alt + Tab: focus the next monitor in Hyprland's monitor order,
    -- leaving its currently displayed workspace selected.
    bind("CTRL + ALT + Tab", hl.dsp.focus({ monitor = "+1" }), "Focus next monitor")

    -- Ctrl + Alt + Shift + Tab: focus the previous monitor in that same order.
    bind("CTRL + ALT + SHIFT + Tab", hl.dsp.focus({ monitor = "-1" }), "Focus previous monitor")

    -- Move only the window; moving whole numbered workspaces would conflict with
    -- workspaces.lua, which distributes the shared 1–10 set across monitors.
    for _, direction in ipairs({ "left", "right", "up", "down" }) do
        -- Super + Ctrl + Shift + arrow: move the focused window to the monitor
        -- in that physical direction and follow it to that monitor's active workspace.
        bind("SUPER + CTRL + SHIFT + " .. direction, hl.dsp.window.move({ monitor = direction:sub(1, 1), follow = true }),
            "Move window to monitor " .. direction .. " and follow")
    end

    -- Super + S: show or hide the scratchpad above the current workspace.
    -- This is a separate workspace for temporarily parking windows, not a new app.
    bind("SUPER + S", hl.dsp.workspace.toggle_special("luna-next-scratchpad"), "Toggle scratchpad")

    -- Super + Alt + S: send the focused window to the scratchpad without following.
    -- Use Super + S to see it, then a numbered move shortcut to move it back out.
    bind("SUPER + ALT + S", hl.dsp.window.move({ workspace = "special:luna-next-scratchpad", follow = false }),
        "Move window to scratchpad")

    local dropdown = "luna-next-terminal"
    -- Remember whether Kitty is starting and whether the latest keypress wants it visible.
    local launching, show_when_ready, launch_timer = false, false, nil

    -- Kitty opens asynchronously. Show its workspace and focus the new terminal
    -- only if the latest keypress still asks for it to be visible.
    hl.on("window.open", function(window)
        if window.class ~= "luna-next-dropdown" then
            return
        end
        launching = false
        if launch_timer then
            launch_timer:set_enabled(false)
            launch_timer = nil
        end

        if show_when_ready then
            show_when_ready = false
            local monitor = hl.get_active_monitor()
            local special = monitor and monitor.active_special_workspace
            if not special or (special.name ~= dropdown and special.name ~= "special:" .. dropdown) then
                hl.dispatch(hl.dsp.workspace.toggle_special(dropdown))
            end
            hl.dispatch(hl.dsp.focus({ window = window }))
        end
    end)

    -- Super + backtick (`), called "grave" here: show or hide a dedicated Kitty terminal.
    -- Start it on first use or after it closes; otherwise reuse the same window.
    -- Hiding it keeps its shell session running in its own special workspace.
    bind("SUPER + grave", function()
        for _, window in ipairs(hl.get_windows()) do
            if window.mapped and window.class == "luna-next-dropdown" then
                -- Recover the terminal if ordinary workspace shortcuts moved it.
                local workspace = window.workspace
                if not workspace or (workspace.name ~= dropdown and workspace.name ~= "special:" .. dropdown) then
                    hl.dispatch(hl.dsp.window.move({ window = window, workspace = "special:" .. dropdown, follow = false }))
                end
                hl.dispatch(hl.dsp.workspace.toggle_special(dropdown))
                return
            end
        end

        -- Rapid presses change the desired visibility while Kitty is starting.
        if launching then
            show_when_ready = not show_when_ready
            return
        end

        launching, show_when_ready = true, true
        -- A failed launch must allow retry. The process lock also prevents duplicate
        -- terminals after a config reload or a startup slower than this timeout.
        launch_timer = hl.timer(function()
            launching, launch_timer = false, nil
        end, { timeout = 5000, type = "oneshot" })
        hl.dispatch(hl.dsp.exec_cmd(
            'flock -n "${XDG_RUNTIME_DIR:?}/luna-next-dropdown-${HYPRLAND_INSTANCE_SIGNATURE:?}.lock" kitty --class luna-next-dropdown'))
    end, "Toggle drop-down terminal")
end
