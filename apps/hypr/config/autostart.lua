-- Session startup runs once; configuration reloads keep the existing processes.
hl.on("hyprland.start", function()
    hl.dispatch(hl.dsp.exec_cmd("/usr/lib/polkit-kde-authentication-agent-1"))
    hl.dispatch(hl.dsp.exec_cmd('"$HOME/.local/bin/luna" menu start'))
    hl.dispatch(hl.dsp.exec_cmd('"$HOME/.local/bin/luna" wallpaper start'))
    hl.dispatch(hl.dsp.exec_cmd('"$HOME/.local/bin/luna" screensaver start'))
end)
