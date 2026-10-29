-- Keyboard layouts, remaps and pointer sensitivity remain personal preferences.
hl.config({
    input = {
        -- A held key repeats 40 times per second after an initial 250 ms delay.
        repeat_rate = 40,
        repeat_delay = 250,

        touchpad = {
            -- Allow tapping the touchpad to click without pressing it down.
            tap_to_click = true,

            -- Suppress accidental touchpad movement while typing on the keyboard.
            disable_while_typing = true,

            -- Physical clicks use finger count: one = left, two = right, three = middle.
            clickfinger_behavior = true,
        },
    },

    -- Keep manually selected dwindle splits when adding or removing windows.
    dwindle = { preserve_split = true },

    -- Swipes use existing workspaces on this monitor instead of creating new IDs.
    -- Disabling use_r keeps navigation within this monitor's workspace set.
    gestures = { workspace_swipe_create_new = false, workspace_swipe_use_r = false },
})

-- Swipe left or right with three fingers to switch workspaces using the limits above.
hl.gesture({ fingers = 3, direction = "horizontal", action = "workspace" })
