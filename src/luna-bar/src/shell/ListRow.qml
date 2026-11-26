pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic

// A selectable row: icon, label with detail, and a trailing icon such as a tick or lock.
Button {
    id: row
    required property var theme
    property string iconName: ""
    /** An absolute image source, such as an app icon, used instead of `icon`. */
    property string image: ""
    required property string label
    property string detail: ""
    property string trailing: ""
    property bool selected: false

    implicitHeight: detail ? 38 : 30
    padding: 0
    leftPadding: 6
    rightPadding: 6
    focusPolicy: Qt.StrongFocus
    Accessible.name: label
    Keys.onReturnPressed: click()
    Keys.onEnterPressed: click()
    HoverHandler { cursorShape: row.enabled ? Qt.PointingHandCursor : Qt.ArrowCursor }
    background: Rectangle {
        color: "transparent"
        radius: row.theme.appearance.rounding
        border.width: row.visualFocus ? 1 : 0
        border.color: row.theme.colors.accent
    }
    contentItem: Item {
        opacity: row.hovered || row.selected ? 1 : 0.85
        Behavior on opacity { NumberAnimation { duration: 100 } }
        Icon {
            id: lead
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            width: row.iconName ? 15 : 0
            height: 15
            visible: row.iconName !== "" && row.image === ""
            name: row.iconName
            ink: row.selected ? row.theme.colors.accent : row.theme.colors.foreground
        }
        Image {
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            width: 16
            height: 16
            visible: row.image !== ""
            source: row.image
            sourceSize: Qt.size(32, 32)
        }
        Column {
            anchors.left: parent.left
            anchors.leftMargin: row.iconName || row.image ? 25 : 0
            anchors.right: end.left
            anchors.rightMargin: 6
            anchors.verticalCenter: parent.verticalCenter
            Text {
                width: parent.width
                text: row.label
                elide: Text.ElideRight
                color: row.selected ? row.theme.colors.accent : row.theme.colors.foreground
                font.family: row.theme.fonts.ui
                font.pixelSize: 12
            }
            Text {
                width: parent.width
                visible: row.detail !== ""
                text: row.detail
                elide: Text.ElideRight
                color: row.theme.colors.foreground
                opacity: 0.6
                font.family: row.theme.fonts.ui
                font.pixelSize: 10
            }
        }
        Icon {
            id: end
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            width: row.trailing ? 14 : 0
            height: 14
            visible: row.trailing !== ""
            name: row.trailing
            ink: row.selected ? row.theme.colors.accent : row.theme.colors.foreground
        }
    }
}
