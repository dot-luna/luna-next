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

    // Publish only a fully parsed and validated config. A rejected reload leaves
    // the previous settings and media intact; it does not rewrite the source.
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
        // The CLI explicitly requests reloads after saving; filesystem changes
        // alone must not replace the shell or its owned media processes.
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

        // "ok" accepts the configuration, not media readiness. The caller polls
        // status() until asynchronous probing, decoding, or player updates finish.
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
