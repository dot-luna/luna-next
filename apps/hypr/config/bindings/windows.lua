-- Loaded by bindings.lua, which supplies the shared shortcut-registration helper.
return function(bind)
    -- Super + W: ask the focused application to close its current window.
    bind("SUPER + W", hl.dsp.window.close(), "Close window")

    -- Super + Shift + W: ask every window on the focused workspace to close,
    -- including floating windows and hidden group tabs. Apps can still ask to save.
    -- If a scratchpad is open, close its windows instead of the workspace underneath.
    bind("SUPER + SHIFT + W", function()
        local workspace = hl.get_active_special_workspace() or hl.get_active_workspace()
        if not workspace then
            return
        end

        -- Capture the targets once: closing a window can change focus or close
        -- other windows belonging to the same app. Never target the new focus.
        local windows = hl.get_windows({ workspace = workspace, mapped = true })
        for _, window in ipairs(windows) do
            if window.mapped then
                hl.dispatch(hl.dsp.window.close({ window = window }))
            end
        end
    end, "Close all windows on focused workspace")

    -- Super + F: toggle fullscreen across the entire monitor, using the compositor's
    -- standard fullscreen behavior even when the current layout handles it differently.
    bind("SUPER + F", hl.dsp.window.fullscreen({ action = "toggle", mode = "fullscreen", layout_aware = false }),
        "Toggle fullscreen")

    -- Super + Alt + F: maximize the focused window within the monitor's working area,
    -- keeping the space reserved for panels and margins.
    bind("SUPER + ALT + F", hl.dsp.window.fullscreen({ action = "toggle", mode = "maximized", layout_aware = false }),
        "Toggle maximized window")

    -- Super + Ctrl + F: ask the app to show fullscreen content inside its normal
    -- window area, without making the compositor give it the entire monitor.
    bind("SUPER + CTRL + F", hl.dsp.window.fullscreen_state({ internal = 0, client = 2, action = "toggle", layout_aware = false }),
        "Toggle fullscreen content inside the window")

    -- Super + T: move the focused window between floating and tiled placement.
    bind("SUPER + T", hl.dsp.window.float({ action = "toggle" }), "Toggle floating window")

    -- Super + J: switch the focused dwindle split between horizontal and vertical.
    -- This layout message applies to dwindle, not the scrolling layout.
    bind("SUPER + J", hl.dsp.layout("togglesplit"), "Toggle tiling split")

    -- Super + P: toggle pseudo tiling, which lets a window keep a smaller size
    -- inside its allotted tile instead of filling that tile completely.
    bind("SUPER + P", hl.dsp.window.pseudo(), "Toggle pseudo tiling")

    -- Register focus, swap and group-entry shortcuts for all four arrow directions.
    for _, direction in ipairs({ "left", "right", "up", "down" }) do
        -- Super + arrow: focus a window in that direction without moving it.
        bind("SUPER + " .. direction:upper(), hl.dsp.focus({ direction = direction }), "Focus window " .. direction)

        -- Super + Shift + arrow: exchange the focused window's position with
        -- another window in that direction.
        bind("SUPER + SHIFT + " .. direction:upper(), hl.dsp.window.swap({ direction = direction }),
            "Swap window " .. direction)

        -- Super + Alt + arrow: move the focused window into an existing tabbed
        -- group in that direction; this shortcut does not create a new group.
        bind("SUPER + ALT + " .. direction:upper(), hl.dsp.window.move({ into_group = direction }),
            "Move window into group " .. direction)
    end

    -- Raise the newly focused window, so cycling also reveals overlapping floats.
    local function cycle(forward)
        return function()
            hl.dispatch(hl.dsp.window.cycle_next({ next = forward }))
            hl.dispatch(hl.dsp.window.bring_to_top())
        end
    end

    -- Alt + Tab: focus the next window, including floating windows, and raise it.
    bind("ALT + TAB", cycle(true), "Next window")

    -- Alt + Shift + Tab: cycle through those windows in reverse and raise the selection.
    bind("ALT + SHIFT + TAB", cycle(false), "Previous window")

    -- Hold Super and drag with the left mouse button (272): move the window.
    bind("SUPER + mouse:272", hl.dsp.window.drag(), "Drag window", { mouse = true })

    -- Hold Super and drag with the right mouse button (273): resize the window.
    bind("SUPER + mouse:273", hl.dsp.window.resize(), "Resize window with mouse", { mouse = true })

    -- Physical minus/equal keys keep working with Shift; Alt selects 25px steps.
    for _, preset in ipairs({ { modifiers = "", pixels = 100 }, { modifiers = "ALT + ", pixels = 25 } }) do
        local modifiers, pixels = preset.modifiers, preset.pixels

        -- Super + minus: shrink the width by 100px; add Alt for 25px steps.
        -- Holding the key repeats the resize.
        bind("SUPER + " .. modifiers .. "code:20", hl.dsp.window.resize({ x = -pixels, y = 0, relative = true }),
            "Shrink window width by " .. pixels .. "px", { repeating = true })

        -- Super + equal: grow the width by 100px; add Alt for 25px steps.
        -- Holding the key repeats the resize.
        bind("SUPER + " .. modifiers .. "code:21", hl.dsp.window.resize({ x = pixels, y = 0, relative = true }),
            "Grow window width by " .. pixels .. "px", { repeating = true })

        -- Super + Shift + minus: shrink the height by 100px; add Alt for 25px steps.
        -- Holding the key repeats the resize.
        bind("SUPER + SHIFT + " .. modifiers .. "code:20", hl.dsp.window.resize({ x = 0, y = -pixels, relative = true }),
            "Shrink window height by " .. pixels .. "px", { repeating = true })

        -- Super + Shift + equal: grow the height by 100px; add Alt for 25px steps.
        -- Holding the key repeats the resize.
        bind("SUPER + SHIFT + " .. modifiers .. "code:21", hl.dsp.window.resize({ x = 0, y = pixels, relative = true }),
            "Grow window height by " .. pixels .. "px", { repeating = true })
    end

    -- Super + O: float and pin the focused window so it stays visible across
    -- workspaces. Press again to unpin it and return it to tiling.
    bind("SUPER + O", function()
        -- Keep every operation aimed at the original window even if focus changes.
        local window = hl.get_active_window()
        if not window then
            return
        end
        local pinned = window.pinned

        -- Pinning requires a non-fullscreen float. Unpin before returning to tiling.
        hl.dispatch(hl.dsp.window.fullscreen_state({ window = window, internal = 0, client = 0, action = "set", layout_aware = false }))
        if pinned then
            hl.dispatch(hl.dsp.window.pin({ window = window, action = "off" }))
            hl.dispatch(hl.dsp.window.float({ window = window, action = "off" }))
        else
            hl.dispatch(hl.dsp.window.float({ window = window, action = "on" }))
            hl.dispatch(hl.dsp.window.pin({ window = window, action = "on" }))
            hl.dispatch(hl.dsp.window.alter_zorder({ window = window, mode = "top" }))
        end
    end, "Toggle sticky floating window")

    -- Super + G: create a tabbed group from the focused window, or dissolve its group.
    bind("SUPER + G", hl.dsp.group.toggle(), "Toggle window group")

    -- Super + Alt + G: remove only the focused window from its group.
    bind("SUPER + ALT + G", hl.dsp.window.move({ out_of_group = true }), "Remove window from group")

    -- Super + Alt + Tab: show the next window in the focused tabbed group.
    bind("SUPER + ALT + TAB", hl.dsp.group.next(), "Next window in group")

    -- Super + Alt + Shift + Tab: show the previous window in that group.
    bind("SUPER + ALT + SHIFT + TAB", hl.dsp.group.prev(), "Previous window in group")

    -- Super + Ctrl + Left: show the previous tab in the focused group.
    bind("SUPER + CTRL + LEFT", hl.dsp.group.prev(), "Previous window in group")

    -- Super + Ctrl + Right: show the next tab in the focused group.
    bind("SUPER + CTRL + RIGHT", hl.dsp.group.next(), "Next window in group")

    -- Provide direct access to the first five tabs in the focused group.
    for index = 1, 5 do
        -- Super + Alt + 1–5: show the tab at that one-based position in the group.
        bind("SUPER + ALT + " .. index, hl.dsp.group.active({ index = index }), "Focus group window " .. index)
    end
end
