pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Io

ShellRoot {
    id: shell

    property var wallpaperSettings: null
    property string settingsStatus: "loading"

    // The Luna API owns JSONC parsing and validation. Publish its JSON snapshot
    // only after decoding it, so a malformed IPC payload keeps the previous media.
    function loadSettings(snapshot) {
        try {
            const next = JSON.parse(snapshot);
            wallpaperSettings = next;
            settingsStatus = "ready";
            return "ok";
        } catch (error) {
            if (!wallpaperSettings)
                settingsStatus = "error";
            console.warn("Luna wallpaper settings: " + error.message);
            return "error: " + error.message;
        }
    }

    Component.onCompleted: {
        // File changes alone must not replace the shell or its owned media.
        Quickshell.watchFiles = false;
        loadSettings(Quickshell.env("LUNA_WALLPAPER_SETTINGS"));
    }

    WallpaperSurface {
        id: surface
        screen: Quickshell.screens[0] || null
        settings: shell.wallpaperSettings
    }

    IpcHandler {
        target: "wallpaper"

        // "ok" accepts the configuration, not media readiness. The caller polls
        // status() until asynchronous probing, decoding, or player updates finish.
        function reload(settings: string): string {
            return shell.loadSettings(settings);
        }

        function snapshot(): string {
            return JSON.stringify(shell.wallpaperSettings);
        }

        function status(): string {
            if (shell.settingsStatus !== "ready")
                return shell.settingsStatus;
            return surface.mediaStatus;
        }
    }
}
