-- Display adjustments are temporary; reloading the config restores monitor settings.
-- Advanced ICC/HDR/VRR settings belong in rules for the exact output name: Hyprland
-- preserves those fields when updating that rule, but cannot clone fallback/desc rules.
return function(bind)
    local initial_scales = {}

    -- Convert physical resolution into desktop space, accounting for rotated outputs.
    local function size(monitor, scale)
        local width, height = monitor.width, monitor.height
        if monitor.transform % 2 == 1 then
            width, height = height, width
        end
        return width / scale, height / scale
    end

    -- Accept only scales that keep whole logical pixels and avoid neighboring screens.
    local function fits(monitor, scale)
        local width, height = size(monitor, scale)
        -- Hyprland requires whole logical pixels after scaling.
        if width ~= math.floor(width) or height ~= math.floor(height) then
            return false
        end
        -- Keep current positions safe. Auto-positioned neighbors may move closer
        -- after an upscale and prevent a later downscale; fixed positions avoid that.
        for _, other in ipairs(hl.get_monitors()) do
            if other.name ~= monitor.name and not other.is_mirror then
                local other_width, other_height = size(other, other.scale)
                if monitor.x < other.x + other_width and other.x < monitor.x + width
                    and monitor.y < other.y + other_height and other.y < monitor.y + height then
                    return false
                end
            end
        end
        return true
    end

    -- Take the nearest valid scale in the requested direction without wrapping at a limit.
    local function scale_monitor(direction)
        local monitor = hl.get_active_monitor()
        -- Mirrored outputs share geometry; leave both ends of a mirror pair alone.
        if not monitor or monitor.is_mirror or #monitor.mirrors > 0 then
            return
        end
        initial_scales[monitor.name] = initial_scales[monitor.name] or monitor.scale
        -- Quarter steps from 1x to 3x, plus the original scale for a round trip.
        local scales = { initial_scales[monitor.name] }
        for quarter = 4, 12 do
            table.insert(scales, quarter / 4)
        end
        table.sort(scales, function(a, b)
            return direction > 0 and a < b or direction < 0 and a > b
        end)

        for _, scale in ipairs(scales) do
            if (scale - monitor.scale) * direction > 0.001 and fits(monitor, scale) then
                -- width/height are physical pixels, even after an earlier scale change.
                -- Do not copy monitor.reserved: it includes panels, so applying it as
                -- reserved_area would count those panels twice. Named rules retain it.
                hl.monitor({ output = monitor.name,
                    mode = string.format("%dx%d@%.6f", monitor.width, monitor.height, monitor.refresh_rate),
                    position = string.format("%dx%d", monitor.x, monitor.y), scale = scale,
                    transform = monitor.transform, cm = monitor.cm })
                return
            end
        end
    end

    -- Super + /: enlarge the focused monitor's UI using the next valid scale.
    -- Skip mirrored outputs and scales that overlap another display; reload to restore.
    bind("SUPER + slash", function() scale_monitor(1) end, "Increase focused monitor scaling")

    -- Super + Alt + /: reduce the focused monitor's UI scale to fit more content.
    -- The original scale remains a candidate, but current monitor positions must allow it.
    bind("SUPER + ALT + slash", function() scale_monitor(-1) end, "Decrease focused monitor scaling")

    -- Super + Ctrl + Z: increase desktop zoom by 0.5, capped at 3x.
    -- This changes cursor zoom, not monitor scale, and needs an active monitor.
    bind("SUPER + CTRL + Z", function()
        if hl.get_active_monitor() then
            hl.config({ cursor = { zoom_factor = math.min(3, hl.get_config("cursor.zoom_factor") + 0.5) } })
        end
    end, "Zoom in on the desktop")

    -- Super + Ctrl + Alt + Z: reset desktop zoom to its normal 1x size.
    bind("SUPER + CTRL + ALT + Z", function()
        hl.config({ cursor = { zoom_factor = 1 } })
    end, "Reset desktop zoom")
end
