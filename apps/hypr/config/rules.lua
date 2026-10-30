-- Follow the exact window activated by a URL/file handler, retaining its workspace.
hl.config({ misc = { focus_on_activate = true } })

-- Layer surfaces need their own blur rule; leave the transparent dismiss area clear.
hl.layer_rule({ match = { namespace = "^luna-next-menu$" }, blur = true, ignore_alpha = 0 })

-- Match Zen's video overlay without affecting ordinary tabs that mention PiP.
hl.window_rule({
    match = { class = "^(zen|zen-browser)$", title = "^Picture-in-Picture$" },
    float = true,
    pin = true,
    keep_aspect_ratio = true,
    size = { 480, 270 },
    move = { "(monitor_w-window_w-24)", "(monitor_h-window_h-24)" },
})

hl.window_rule({
    match = { class = "^xdg-desktop-portal-gtk$" },
    float = true,
    center = true,
})

-- Silent placement lets the shortcut decide whether a slow launch is still wanted.
hl.window_rule({
    match = { class = "^luna-next-dropdown$" },
    workspace = "special:luna-next-terminal silent",
    float = true,
    size = { "(monitor_w*0.9)", "(monitor_h*0.5)" },
    move = { "((monitor_w-window_w)/2)", "24" },
})
