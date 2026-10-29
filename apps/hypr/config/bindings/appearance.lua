-- Appearance toggles preserve values from the first press and reset on config reload.
return function(bind)
    local saved = {}
    local layouts = {}

    -- Save the current values on the first press; the next press restores them.
    -- Each toggle remembers its own settings, so gaps and opacity remain independent.
    local function toggle(name, values)
        if saved[name] then
            hl.config(saved[name])
            saved[name] = nil
            return
        end
        local previous = {}
        for key in pairs(values) do
            previous[key] = hl.get_config(key)
        end
        saved[name] = previous
        hl.config(values)
    end

    -- Super + Ctrl + L: switch this numbered workspace between dwindle and scrolling.
    -- Later presses toggle the override off/on; named and special workspaces stay untouched.
    -- Only create overrides for these two layouts; reloading restores the configured layout.
    bind("SUPER + CTRL + L", function()
        local workspace = hl.get_active_workspace()
        -- Range selectors keep overrides independent of monitor assignment rules.
        -- Named workspaces use negative IDs; leave them and scratchpads untouched.
        if not workspace or workspace.special or workspace.id <= 0 or hl.get_active_special_workspace() then
            return
        end
        local rule = layouts[workspace.id]
        if rule then
            rule:set_enabled(not rule:is_enabled())
        elseif workspace.tiled_layout == "dwindle" or workspace.tiled_layout == "scrolling" then
            layouts[workspace.id] = hl.workspace_rule({
                workspace = string.format("r[%d-%d] s[false]", workspace.id, workspace.id),
                layout = workspace.tiled_layout == "dwindle" and "scrolling" or "dwindle",
            })
        end
    end, "Toggle workspace between dwindle and scrolling")

    -- Super + Shift + Backspace: remove inner and outer window gaps globally.
    -- Press again to restore the previous gap sizes, including different sizes per edge.
    bind("SUPER + SHIFT + BackSpace", function()
        toggle("gaps", { ["general.gaps_in"] = 0, ["general.gaps_out"] = 0 })
    end, "Toggle window gaps")

    -- Super + Backspace: make the global window opacity settings fully opaque.
    -- If already opaque, use 90% opacity for normal windows and keep fullscreen opaque.
    -- Press again to restore the previous values; app-specific opacity rules still apply.
    bind("SUPER + BackSpace", function()
        local active = hl.get_config("decoration.active_opacity")
        local inactive = hl.get_config("decoration.inactive_opacity")
        local fullscreen = hl.get_config("decoration.fullscreen_opacity")
        local opaque = active == 1 and inactive == 1 and fullscreen == 1
        toggle("opacity", {
            ["decoration.active_opacity"] = opaque and 0.9 or 1,
            ["decoration.inactive_opacity"] = opaque and 0.9 or 1,
            ["decoration.fullscreen_opacity"] = 1,
        })
    end, "Toggle window transparency")

    -- Super + Ctrl + Backspace: give a lone tiled window square proportions in dwindle.
    -- If already square, remove the constraint instead; the next press restores the saved ratio.
    -- This global setting does not change scrolling layout behavior.
    bind("SUPER + CTRL + BackSpace", function()
        local ratio = hl.get_config("layout.single_window_aspect_ratio")
        toggle("aspect", { ["layout.single_window_aspect_ratio"] = ratio[1] == 1 and ratio[2] == 1
            and { 0, 0 } or { 1, 1 } })
    end, "Toggle square aspect for a lone tiled window")
end
