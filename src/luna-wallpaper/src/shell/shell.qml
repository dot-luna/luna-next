pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import LunaNext.Config

ShellRoot {
    id: shell

    readonly property string configHome: Quickshell.env("XDG_CONFIG_HOME") || Quickshell.env("HOME") + "/.config"
    readonly property string configPath: Quickshell.env("LUNA_WALLPAPER_CONFIG") || configHome + "/luna-next/wallpaper.conf"
    property var config: null
    property string configStatus: "loading"

    Component.onCompleted: {
        Quickshell.watchFiles = false;
        try {
            config = Config.load_as_json(configPath, Quickshell.shellPath("../config.schema.json"));
            configStatus = "ready";
        } catch (error) {
            configStatus = "error";
            console.warn("Wallpaper config: " + error.message);
        }
    }

    WallpaperSurface {
        id: surface
        screen: Quickshell.screens[0] || null
        settings: shell.config
    }
}
