pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Io
import LunaNext.Config

ShellRoot {
    id: shell

    readonly property string configHome: Quickshell.env("XDG_CONFIG_HOME") || Quickshell.env("HOME") + "/.config"
    property string configPath: Quickshell.env("LUNA_WALLPAPER_CONFIG") || configHome + "/luna-next/wallpaper.conf"
    property var config: null
    property string configStatus: "loading"

    function loadConfig(path) {
        try {
            const next = Config.load_as_json(path, Quickshell.shellPath("../config.schema.json"));
            configPath = path;
            config = next;
            configStatus = "ready";
            return "ok";
        } catch (error) {
            if (!config)
                configStatus = "error";
            console.warn("Wallpaper config: " + error.message);
            return "error: " + error.message;
        }
    }

    Component.onCompleted: {
        Quickshell.watchFiles = false;
        loadConfig(configPath);
    }

    WallpaperSurface {
        id: surface
        screen: Quickshell.screens[0] || null
        settings: shell.config
    }

    IpcHandler {
        target: "wallpaper"

        function reload(path: string): string {
            return shell.loadConfig(path);
        }

        function status(): string {
            if (shell.configStatus !== "ready")
                return shell.configStatus;
            return surface.mediaStatus;
        }
    }
}
