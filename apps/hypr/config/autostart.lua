-- Configuration reloads do not restart the wallpaper process.
hl.on("hyprland.start", function()
    hl.dispatch(hl.dsp.exec_cmd('"$HOME/.local/bin/luna" wallpaper start'))
    hl.dispatch(hl.dsp.exec_cmd('"$HOME/.local/bin/luna" polkit start'))
    hl.dispatch(hl.dsp.exec_cmd('"$HOME/.local/bin/luna" menu start'))
end)
