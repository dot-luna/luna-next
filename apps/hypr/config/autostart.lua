-- Configuration reloads do not restart the wallpaper process.
hl.on("hyprland.start", function()
    hl.dispatch(hl.dsp.exec_cmd(
        'QML_IMPORT_PATH="$HOME/.local/lib/qt6/qml${QML_IMPORT_PATH:+:$QML_IMPORT_PATH}" "$HOME/.local/bin/lnxt" wallpaper start'))
    hl.dispatch(hl.dsp.exec_cmd('"$HOME/.local/bin/lnxt" polkit start'))
end)
