pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic

Rectangle {
    id: shutdown
    required property var theme
    required property var actions
    readonly property bool active: actions?.shutdownActive ?? false
    readonly property bool committed: actions?.committed ?? false
    readonly property int remainingSeconds: actions?.remainingSeconds ?? 0
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

    Column {
        anchors.centerIn: parent
        spacing: 22
        Text {
            objectName: "shutdownMessage"
            anchors.horizontalCenter: parent.horizontalCenter
            text: (shutdown.committed ? qsTr("Shutting down…") : shutdown.remainingSeconds === 1 ? qsTr("Shutting down in 1 second") : qsTr("Shutting down in %1 seconds").arg(shutdown.remainingSeconds))
            color: shutdown.theme.colors.bright_foreground
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
            onClicked: shutdown.actions.cancelShutdown()
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
