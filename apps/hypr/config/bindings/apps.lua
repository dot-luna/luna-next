return function(bind)
    bind("SUPER + Space", hl.dsp.exec_cmd('"$HOME/.local/bin/luna" menu toggle'), "Toggle Luna menu")
    bind("SUPER + Escape", hl.dsp.exec_cmd('"$HOME/.local/bin/luna" menu system'), "Open Luna system menu")
    bind("SUPER + N", hl.dsp.exec_cmd('"$HOME/.local/bin/luna" notify focus'), "Focus notification toasts")
    bind("SUPER + L", hl.dsp.exec_cmd('"$HOME/.local/bin/luna" lock'), "Lock session")
    bind("SUPER + Return", hl.dsp.exec_cmd("xdg-terminal-exec"), "Open default terminal")

    bind("Print", hl.dsp.exec_cmd('"$HOME/.local/bin/luna" screenshot region'), "Screenshot region",
        { repeating = false })
    bind("SHIFT + Print", hl.dsp.exec_cmd('"$HOME/.local/bin/luna" screenshot screen'), "Screenshot current screen",
        { repeating = false })
    bind("ALT + Print", hl.dsp.exec_cmd('"$HOME/.local/bin/luna" screenshot window'), "Screenshot active window",
        { repeating = false })
    bind("CTRL + Print", hl.dsp.exec_cmd('"$HOME/.local/bin/luna" screenshot all'), "Screenshot all screens",
        { repeating = false })

    -- Resolve the browser on each press so changes to the default take effect immediately.
    bind("SUPER + SHIFT + Return", hl.dsp.exec_cmd('gtk-launch -- "$(xdg-mime query default x-scheme-handler/https)"'),
        "Open default browser")
end
