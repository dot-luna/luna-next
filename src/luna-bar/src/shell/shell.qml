pragma ComponentBehavior: Bound
import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io

ShellRoot {
    id: shell
    property var theme: null
    property var settings: null
    // Runtime-only: every screen shows or hides together, and a restart shows the bar again.
    property bool shown: true

    Variants {
        id: bars
        model: shell.theme && shell.settings ? Quickshell.screens : []
        Bar {
            required property var modelData
            screen: modelData
            theme: shell.theme
            settings: shell.settings
            shown: shell.shown
        }
    }
    IpcHandler {
        target: "bar"
        function status(): string { return shell.theme && bars.instances.length > 0 ? "running" : "unavailable"; }
        function focus(): void {
            shell.shown = true;
            const monitor = Hyprland.focusedMonitor;
            for (const bar of bars.instances) {
                bar.release();
                if (monitor && bar.screen.name === monitor.name) bar.beginFocus();
            }
        }
        function toggle(): string {
            shell.shown = !shell.shown;
            return shell.shown ? "visible" : "hidden";
        }
    }
    Component.onCompleted: {
        Quickshell.watchFiles = false;
        try {
            const theme = JSON.parse(Quickshell.env("LUNA_BAR_THEME"));
            if (!theme || !theme.colors || !theme.fonts || !theme.appearance)
                throw new Error("missing theme snapshot");
            const settings = JSON.parse(Quickshell.env("LUNA_BAR_SETTINGS"));
            if (!settings || !settings.workspaces || !settings.clock)
                throw new Error("missing settings snapshot");
            shell.settings = settings;
            shell.theme = theme;
        } catch (error) {
            console.error("Luna bar: " + error.message + ". Start with luna bar start.");
            Qt.callLater(() => Qt.exit(1));
        }
    }
}
