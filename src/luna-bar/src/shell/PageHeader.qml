pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic

// A page title with a back button and an optional on/off switch.
Item {
    id: header
    required property var theme
    required property string title
    property bool hasSwitch: false
    property bool checked: false
    signal back()
    signal switched()

    implicitHeight: 28

    IconButton {
        id: back
        objectName: "pageBack"
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
        theme: header.theme
        iconName: "arrow-left-01"
        Accessible.name: "Back"
        onClicked: header.back()
    }
    Text {
        anchors.left: back.right
        anchors.leftMargin: 4
        anchors.verticalCenter: parent.verticalCenter
        text: header.title
        color: header.theme.colors.foreground
        font.family: header.theme.fonts.ui
        font.pixelSize: 13
        font.bold: true
    }
    Switch {
        id: toggle
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        visible: header.hasSwitch
        checked: header.checked
        padding: 0
        focusPolicy: Qt.StrongFocus
        Accessible.name: header.title
        onToggled: header.switched()
        HoverHandler { cursorShape: Qt.PointingHandCursor }
        indicator: Rectangle {
            implicitWidth: 30
            implicitHeight: 16
            radius: Math.min(header.theme.appearance.rounding, height / 2)
            color: "transparent"
            border.width: 1
            border.color: toggle.checked || toggle.visualFocus ? header.theme.colors.accent : header.theme.colors.muted
            Rectangle {
                x: toggle.checked ? parent.width - width - 3 : 3
                anchors.verticalCenter: parent.verticalCenter
                width: 10
                height: 10
                radius: Math.min(header.theme.appearance.rounding, 5)
                color: toggle.checked ? header.theme.colors.accent : header.theme.colors.foreground
                opacity: toggle.checked ? 1 : 0.5
                Behavior on x { NumberAnimation { duration: 140; easing.type: Easing.OutCubic } }
            }
        }
        contentItem: null
    }
}
