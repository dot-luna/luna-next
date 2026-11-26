pragma ComponentBehavior: Bound

import QtQuick
import Quickshell

// This entry has no session-lock or PAM objects, IPC, idle monitor, or power commands.
ShellRoot {
    id: preview
    property var theme: JSON.parse(Quickshell.env("LUNA_LOCK_THEME"))

    PowerActions {
        id: previewActions
        secure: true
        shutdownDelay: JSON.parse(Quickshell.env("LUNA_LOCK_SETTINGS") || "{}").actions?.shutdown_delay ?? 3
        supportedActions: ["suspend", "hibernate", "hybridSleep", "reboot", "powerOff"]
        onDispatchRequested: action => {
            shutdownActive = false;
            committed = false;
            errorMessage = qsTr("Preview only");
        }
    }

    FloatingWindow {
        id: window
        title: "Luna Lock Preview"
        implicitWidth: 1280
        implicitHeight: 800
        color: preview.theme.colors.background
        visible: true

        SystemClock {
            id: clock
            precision: SystemClock.Minutes
        }
        LockView {
            id: view
            anchors.fill: parent
            theme: preview.theme
            actions: previewActions
            dateTime: clock.date
            username: Quickshell.env("LUNA_LOCK_USER") || ""
            userIcon: Quickshell.env("LUNA_LOCK_USER_ICON") || ""
            responseRequired: true
            keyboardActive: true
            onSubmitted: response => {
                // A preview can exercise failure feedback without checking or retaining the response.
                statusText = qsTr("Try again");
                clearInput();
            }
        }
    }
    Connections {
        target: Quickshell
        function onLastWindowClosed() {
            Qt.quit();
        }
    }
    Component.onCompleted: Quickshell.watchFiles = false
}
