pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic

Rectangle {
    id: shutdown
    required property var theme
    required property var login
    required property int delaySeconds
    property bool active: false
    property bool committed: false
    property int remainingSeconds: 0
    property double deadline: 0
    property string errorMessage: ""
    signal cancelled
    color: theme.colors.background
    opacity: active ? 1 : 0
    visible: active || opacity > 0
    enabled: active
    Behavior on opacity {
        NumberAnimation {
            duration: 180
            easing.type: Easing.OutQuad
        }
    }

    function start() {
        if (active || login.busy || !login.canPowerOff)
            return false;
        remainingSeconds = delaySeconds;
        deadline = Date.now() + delaySeconds * 1000;
        errorMessage = "";
        committed = false;
        active = true;
        if (delaySeconds === 0)
            dispatch();
        return true;
    }

    function cancel() {
        if (!active || committed)
            return false;
        active = false;
        cancelled();
        return true;
    }

    function dispatch() {
        // Stop ticking before calling SDDM so a request can only be sent once.
        committed = true;
        if (!login.requestAction("powerOff")) {
            committed = false;
            errorMessage = qsTr("Shutdown is unavailable.");
        }
    }

    Timer {
        interval: 100
        repeat: true
        running: shutdown.active && !shutdown.committed && shutdown.errorMessage === ""
        onTriggered: {
            shutdown.remainingSeconds = Math.max(0, Math.ceil((shutdown.deadline - Date.now()) / 1000));
            if (shutdown.remainingSeconds === 0)
                shutdown.dispatch();
        }
    }

    Column {
        anchors.centerIn: parent
        spacing: 22
        Text {
            objectName: "shutdownMessage"
            anchors.horizontalCenter: parent.horizontalCenter
            text: shutdown.errorMessage || (shutdown.committed ? qsTr("Shutting down…") : shutdown.remainingSeconds === 1 ? qsTr("Shutting down in 1 second") : qsTr("Shutting down in %1 seconds").arg(shutdown.remainingSeconds))
            color: shutdown.errorMessage ? shutdown.theme.colors.error : shutdown.theme.colors.bright_foreground
            font.family: shutdown.theme.fonts.ui
            font.pixelSize: 28
            font.weight: Font.Medium
            Accessible.role: Accessible.AlertMessage
        }
        Button {
            id: cancelButton
            objectName: "cancelShutdownButton"
            anchors.horizontalCenter: parent.horizontalCenter
            visible: !shutdown.committed
            text: qsTr("Cancel (Esc)")
            padding: 12
            hoverEnabled: true
            font.family: shutdown.theme.fonts.ui
            font.pixelSize: 13
            palette.buttonText: shutdown.theme.colors.foreground
            onClicked: shutdown.cancel()
            background: Rectangle {
                radius: shutdown.theme.appearance.rounding
                color: cancelButton.down ? shutdown.theme.colors.selection : cancelButton.hovered ? Qt.alpha(shutdown.theme.colors.selection, 0.6) : "transparent"
                border.width: 1
                border.color: cancelButton.visualFocus ? shutdown.theme.colors.accent : shutdown.theme.colors.muted
                Behavior on color {
                    ColorAnimation {
                        duration: 110
                    }
                }
            }
        }
    }
}
