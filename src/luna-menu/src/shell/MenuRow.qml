pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import Quickshell

Button {
    id: row
    required property var entry
    required property var theme
    required property string uiFont
    required property real textSize
    required property real textScale
    required property bool selected
    required property bool appsView
    readonly property bool applicationEntry: typeof entry.execute === "function"

    Accessible.name: entry.name
    Accessible.role: Accessible.ListItem
    focusPolicy: Qt.NoFocus
    height: 48 * textScale
    leftPadding: 12
    rightPadding: 12
    topPadding: 8
    bottomPadding: 8
    hoverEnabled: true
    background: Item {}
    contentItem: RowLayout {
        spacing: 14
        Item {
            Layout.preferredWidth: 20
            Layout.preferredHeight: 20
            Image {
                id: appIcon
                anchors.fill: parent
                visible: row.applicationEntry
                source: !row.applicationEntry || !row.entry.icon ? ""
                    : row.entry.icon.startsWith("/")
                        ? "file://" + row.entry.icon.split("/").map(encodeURIComponent).join("/")
                        : Quickshell.iconPath(row.entry.icon, true)
                sourceSize: Qt.size(32, 32)
                fillMode: Image.PreserveAspectFit
            }
            Icon {
                anchors.fill: parent
                visible: !row.applicationEntry || appIcon.status !== Image.Ready
                name: row.applicationEntry ? "grid-view" : row.entry.icon
                ink: row.selected ? row.theme.colors.selection_foreground : row.theme.colors.foreground
            }
        }
        Label {
            Layout.fillWidth: true
            color: row.selected ? row.theme.colors.selection_foreground : row.theme.colors.bright_foreground
            font.family: row.uiFont
            font.pointSize: row.textSize + 1
            font.weight: row.selected ? Font.Medium : Font.Normal
            elide: Text.ElideRight
            text: row.entry.name
            textFormat: Text.PlainText
        }
        Label {
            visible: row.applicationEntry && !row.appsView
            text: "Apps"
            color: row.selected ? row.theme.colors.selection_foreground : row.theme.colors.foreground
            opacity: 0.65
            font.family: row.uiFont
            font.pointSize: Math.max(1, row.textSize - 1)
            textFormat: Text.PlainText
        }
        Icon {
            Layout.preferredWidth: 14
            Layout.preferredHeight: 14
            name: "arrow-right-01"
            ink: row.theme.colors.selection_foreground
            visible: row.selected && Boolean(row.entry.route)
        }
    }
}
