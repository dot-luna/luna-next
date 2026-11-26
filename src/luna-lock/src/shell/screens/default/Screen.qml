pragma ComponentBehavior: Bound

import QtQuick
import "."

Item {
    id: screen
    required property var lock
    property bool appeared: false
    readonly property bool compact: height < 700
    readonly property bool shutdownActive: lock.actions?.shutdownActive ?? false
    readonly property bool resting: !form.passwordVisible && !shutdownActive
    opacity: appeared ? 1 : 0
    focus: true

    Behavior on opacity {
        NumberAnimation {
            duration: 240
            easing.type: Easing.InOutQuad
        }
    }

    function focusInput() {
        if (!lock.keyboardActive)
            return;
        if (form.passwordVisible && !lock.busy && !shutdownActive)
            form.revealPassword("");
        else
            forceActiveFocus(Qt.OtherFocusReason);
    }

    Connections {
        target: screen.lock
        function onFocusRequested() {
            screen.focusInput();
        }
    }

    Connections {
        target: screen.lock.actions
        function onShutdownActiveChanged() {
            if (screen.shutdownActive)
                form.dismiss();
            screen.focusInput();
        }
    }

    Keys.onPressed: event => {
        screen.lock.activity();
        if (event.key === Qt.Key_Escape) {
            if (screen.shutdownActive)
                screen.lock.actions.cancelShutdown();
            else
                form.dismiss();
            event.accepted = true;
        } else if (screen.shutdownActive) {
            event.accepted = event.key !== Qt.Key_Tab && event.key !== Qt.Key_Backtab;
        } else if (!form.passwordVisible) {
            if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
                form.revealPassword("");
                event.accepted = true;
            } else if (event.text && !(event.modifiers & (Qt.ControlModifier | Qt.AltModifier | Qt.MetaModifier)) && event.text.charCodeAt(0) >= 32) {
                form.revealPassword(event.text);
                event.accepted = true;
            }
        }
    }

    ScreenBackground {
        anchors.fill: parent
        settings: ({
                theme: screen.lock.theme,
                background: screen.lock.theme.background || {
                    path: ""
                }
            })
    }

    MouseArea {
        anchors.fill: parent
        acceptedButtons: Qt.AllButtons
        hoverEnabled: true
        onPressed: mouse => {
            screen.lock.activity();
            if (mouse.button === Qt.LeftButton)
                form.revealPassword("");
            mouse.accepted = false;
        }
        onPositionChanged: screen.lock.activity()
        onWheel: wheel => {
            screen.lock.activity();
            wheel.accepted = true;
        }
    }

    Column {
        anchors.horizontalCenter: parent.horizontalCenter
        y: Math.max(28, Math.round(screen.height * 0.08))
        spacing: 2
        opacity: screen.resting ? 1 : 0
        visible: screen.resting || opacity > 0
        enabled: screen.resting
        Behavior on opacity {
            NumberAnimation {
                duration: 160
                easing.type: Easing.OutQuad
            }
        }
        Text {
            objectName: "lock-clock"
            anchors.horizontalCenter: parent.horizontalCenter
            text: Qt.formatTime(screen.lock.dateTime, "hh:mm")
            color: screen.lock.theme.colors.bright_foreground
            font.family: screen.lock.theme.fonts.ui
            font.pixelSize: screen.compact ? 64 : 88
            font.weight: Font.Medium
            font.letterSpacing: -3
        }
        Text {
            objectName: "lock-date"
            anchors.horizontalCenter: parent.horizontalCenter
            text: Qt.formatDate(screen.lock.dateTime, "dddd, d MMMM")
            color: screen.lock.theme.colors.foreground
            font.family: screen.lock.theme.fonts.ui
            font.pixelSize: 15
            opacity: 0.85
        }
    }

    LockForm {
        id: form
        objectName: "lock-form"
        anchors.horizontalCenter: parent.horizontalCenter
        y: Math.round((screen.height - implicitHeight) / 2)
        width: Math.min(320, screen.width - 48)
        opacity: screen.shutdownActive ? 0 : 1
        visible: !screen.shutdownActive || opacity > 0
        enabled: !screen.shutdownActive
        Behavior on opacity {
            NumberAnimation {
                duration: 160
                easing.type: Easing.OutQuad
            }
        }
        lock: screen.lock
        compact: screen.compact
        onRestRequested: screen.forceActiveFocus(Qt.OtherFocusReason)
    }

    Column {
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottom: parent.bottom
        anchors.bottomMargin: Math.max(28, Math.round(screen.height * 0.05))
        spacing: 8
        opacity: screen.resting ? 1 : 0
        visible: screen.resting || opacity > 0
        enabled: screen.resting
        Behavior on opacity {
            NumberAnimation {
                duration: 160
                easing.type: Easing.OutQuad
            }
        }
        LockFooter {
            objectName: "lock-actions"
            anchors.horizontalCenter: parent.horizontalCenter
            lock: screen.lock
            onActionRequested: action => {
                screen.lock.activity();
                screen.lock.actions.requestAction(action);
            }
        }
        Text {
            anchors.horizontalCenter: parent.horizontalCenter
            text: screen.lock.actions?.errorMessage ?? ""
            visible: text !== ""
            color: screen.lock.theme.colors.error
            font.family: screen.lock.theme.fonts.ui
            font.pixelSize: 13
            Accessible.role: Accessible.AlertMessage
        }
    }

    ShutdownView {
        anchors.fill: parent
        theme: screen.lock.theme
        actions: screen.lock.actions
    }

    Component.onCompleted: {
        appeared = true;
        focusInput();
    }
}
