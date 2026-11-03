pragma ComponentBehavior: Bound
import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io

ShellRoot {
    id: shell
    readonly property ToastWindow toasts: window.item as ToastWindow
    property var theme: null
    property var toastScreen: Quickshell.screens[0] || null

    NotificationStore {
        id: notificationStore
        onReceived: {
            const monitor = Hyprland.focusedMonitor;
            shell.toastScreen = Quickshell.screens.find(screen => monitor && screen.name === monitor.name)
                || Quickshell.screens[0] || null;
        }
    }
    Loader {
        id: window
        active: shell.theme !== null
        sourceComponent: ToastWindow {
            theme: shell.theme
            store: notificationStore
            screen: Quickshell.screens.includes(shell.toastScreen) ? shell.toastScreen : Quickshell.screens[0] || null
        }
    }
    IpcHandler {
        target: "notify"
        function pid(): string { return shell.theme ? String(Quickshell.processId) : "unavailable"; }
        function focus(): void { if (shell.toasts) shell.toasts.focusToasts(); }
        function dismiss(): void { notificationStore.dismiss(); }
    }
    Component.onCompleted: {
        Quickshell.watchFiles = false;
        try {
            const value = JSON.parse(Quickshell.env("LUNA_NOTIFY_THEME"));
            if (!value || !value.colors || !value.fonts || !value.appearance)
                throw new Error("expected a resolved Luna theme");
            theme = value;
        } catch (error) {
            console.error("Luna notification theme: " + error.message + ". Use luna notify start.");
            Qt.callLater(() => Qt.exit(1));
        }
    }
}
