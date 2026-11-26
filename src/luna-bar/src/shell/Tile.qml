pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic

// A toggle tile. With `hasMore`, its right side is a separate chevron that opens a page.
Item {
    id: tile
    required property var theme
    required property string iconName
    required property string label
    property string detail: ""
    property bool active: false
    property bool hasMore: false
    property bool toggleEnabled: true
    signal toggled()
    signal more()

    implicitHeight: 40

    Rectangle {
        anchors.fill: parent
        color: "transparent"
        radius: tile.theme.appearance.rounding
        border.width: 1
        border.color: tile.active ? tile.theme.colors.accent : tile.theme.colors.muted
        Behavior on border.color { ColorAnimation { duration: 140 } }
    }
    Button {
        id: main
        enabled: tile.toggleEnabled
        anchors.left: parent.left
        anchors.right: chevron.left
        height: parent.height
        padding: 0
        leftPadding: 9
        rightPadding: 6
        focusPolicy: Qt.StrongFocus
        Accessible.name: tile.label
        onClicked: tile.toggled()
        Keys.onReturnPressed: click()
        Keys.onEnterPressed: click()
        HoverHandler { cursorShape: main.enabled ? Qt.PointingHandCursor : Qt.ArrowCursor }
        background: Rectangle {
            color: "transparent"
            radius: tile.theme.appearance.rounding
            border.width: main.visualFocus ? 1 : 0
            border.color: tile.theme.colors.accent
        }
        contentItem: Row {
            spacing: 8
            opacity: main.hovered ? 1 : 0.92
            Icon {
                anchors.verticalCenter: parent.verticalCenter
                width: 15
                height: 15
                name: tile.iconName
                ink: tile.active ? tile.theme.colors.accent : tile.theme.colors.foreground
            }
            Column {
                anchors.verticalCenter: parent.verticalCenter
                width: main.availableWidth - 23
                Text {
                    width: parent.width
                    text: tile.label
                    elide: Text.ElideRight
                    color: tile.active ? tile.theme.colors.accent : tile.theme.colors.foreground
                    font.family: tile.theme.fonts.ui
                    font.pixelSize: 12
                    Behavior on color { ColorAnimation { duration: 140 } }
                }
                Text {
                    width: parent.width
                    visible: tile.detail !== ""
                    text: tile.detail
                    elide: Text.ElideRight
                    color: tile.theme.colors.foreground
                    opacity: 0.6
                    font.family: tile.theme.fonts.ui
                    font.pixelSize: 10
                }
            }
        }
    }
    Rectangle {
        anchors.right: chevron.left
        width: tile.hasMore ? 1 : 0
        height: parent.height
        color: tile.active ? tile.theme.colors.accent : tile.theme.colors.muted
    }
    IconButton {
        id: chevron
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        theme: tile.theme
        iconName: "arrow-right-01"
        active: tile.active
        size: tile.hasMore ? 28 : 0
        width: tile.hasMore ? 28 : 0
        height: tile.hasMore ? tile.height : 0
        visible: tile.hasMore
        Accessible.name: tile.label + " settings"
        onClicked: tile.more()
    }
}
