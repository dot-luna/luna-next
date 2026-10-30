return function(bind)
    bind("SUPER + Space", hl.dsp.exec_cmd('"$HOME/.local/bin/luna" menu toggle'), "Toggle Luna menu")
    bind("SUPER + Return", hl.dsp.exec_cmd("xdg-terminal-exec"), "Open default terminal")

    -- Resolve the browser on each press so changes to the default take effect immediately.
    bind("SUPER + SHIFT + Return", hl.dsp.exec_cmd('gtk-launch -- "$(xdg-mime query default x-scheme-handler/https)"'),
        "Open default browser")
end
