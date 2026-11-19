pragma ComponentBehavior: Bound
import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io

ShellRoot {
    id: shell
    property var theme: null

    Variants {
        id: bars
        model: shell.theme ? Quickshell.screens : []
        Bar {
            required property var modelData
            screen: modelData
            theme: shell.theme
        }
    }
    IpcHandler {
        target: "bar"
        function status(): string { return shell.theme && bars.instances.length > 0 ? "running" : "unavailable"; }
        function focus(): void {
            const monitor = Hyprland.focusedMonitor;
            for (const bar of bars.instances) {
                bar.release();
                if (monitor && bar.screen.name === monitor.name) bar.beginFocus();
            }
        }
    }
    Component.onCompleted: {
        Quickshell.watchFiles = false;
        try {
            const value = JSON.parse(Quickshell.env("LUNA_BAR_THEME"));
            if (!value || !value.colors || !value.fonts || !value.appearance)
                throw new Error("missing theme snapshot");
            theme = value;
        } catch (error) {
            console.error("Luna bar theme: " + error.message + ". Start with luna bar start.");
            Qt.callLater(() => Qt.exit(1));
        }
    }
}
