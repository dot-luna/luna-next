pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic

// A small icon button; `framed` adds the theme border used for panel actions.
Button {
    id: button
    required property var theme
    required property string iconName
    property bool framed: false
    property bool active: false
    property int size: 28

    implicitWidth: size
    implicitHeight: size
    padding: 0
    focusPolicy: Qt.StrongFocus
    Keys.onReturnPressed: click()
    Keys.onEnterPressed: click()
    HoverHandler { cursorShape: Qt.PointingHandCursor }
    background: Rectangle {
        color: "transparent"
        radius: Math.min(button.theme.appearance.rounding, height / 2)
        border.width: button.framed || button.visualFocus ? 1 : 0
        border.color: button.visualFocus || button.active ? button.theme.colors.accent : button.theme.colors.muted
    }
    contentItem: Item {
        opacity: button.enabled ? (button.hovered || button.active ? 1 : 0.75) : 0.35
        Behavior on opacity { NumberAnimation { duration: 100 } }
        Icon {
            anchors.centerIn: parent
            width: 15
            height: 15
            name: button.iconName
            ink: button.active ? button.theme.colors.accent : button.theme.colors.foreground
        }
    }
}
