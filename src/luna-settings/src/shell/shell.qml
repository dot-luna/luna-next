pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Window
import Quickshell
import Quickshell.Wayland

ShellRoot {
    id: shell
    property var theme: null

    Loader {
        active: shell.theme !== null
        sourceComponent: FloatingWindow {
            id: window
            title: "Luna Settings"
            implicitWidth: 1000
            implicitHeight: 720
            minimumSize: Qt.size(740, 560)
            visible: true
            color: "transparent"
            BackgroundEffect.blurRegion: shell.theme.appearance.blur.enabled ? blurRegion : null

            Region { id: blurRegion; item: view; radius: shell.theme.appearance.rounding }

            SettingsView {
                id: view
                anchors.fill: parent
                themeSnapshot: shell.theme
                surfaceOpacity: window.fullscreen ? shell.theme.appearance.opacity.fullscreen
                    : window.contentItem.Window.active ? shell.theme.appearance.opacity.active : shell.theme.appearance.opacity.inactive
                onDismissed: Qt.quit()
            }
        }
    }

    Connections {
        target: Quickshell
        function onLastWindowClosed() { Qt.quit(); }
    }

    Component.onCompleted: {
        Quickshell.watchFiles = false;
        try {
            const source = Quickshell.env("LUNA_SETTINGS_THEME");
            if (!source) throw new Error("Start Settings with bun run --cwd src/luna-settings dev");
            // The launcher supplies the shared API's validated, resolved theme once per start.
            theme = JSON.parse(source);
        } catch (error) {
            console.error("Luna Settings: " + error.message);
            Qt.callLater(() => Qt.exit(1));
        }
    }
}
