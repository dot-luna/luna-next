pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

Button {
    id: row
    required property var entry
    required property var theme
    required property string uiFont
    required property real textSize
    required property real textScale
    required property bool selected
    required property bool appsView
    property bool loadAttachments: true
    property string applicationIcon: ""
    readonly property bool applicationEntry: typeof entry.execute === "function"

    Accessible.name: entry.name
    Accessible.role: Accessible.ListItem
    Accessible.checkable: typeof entry.checked === "boolean"
    Accessible.checked: entry.checked === true
    focusPolicy: Qt.NoFocus
    height: (attachment.content && attachment.content.ready ? 80 : 48) * textScale
    leftPadding: 12
    rightPadding: 12
    topPadding: 8
    bottomPadding: 8
    hoverEnabled: true
    background: Item {}
    contentItem: RowLayout {
        spacing: 14
        Item {
            objectName: "entryIcon"
            visible: !row.entry.clipboard
            Layout.preferredWidth: 20
            Layout.preferredHeight: 20
            Image {
                id: appIcon
                anchors.fill: parent
                visible: row.applicationEntry
                source: row.applicationEntry ? row.applicationIcon : ""
                sourceSize: Qt.size(32, 32)
                fillMode: Image.PreserveAspectFit
            }
            Icon {
                anchors.fill: parent
                visible: !row.applicationEntry || appIcon.status !== Image.Ready
                name: row.applicationEntry ? "grid-view" : row.entry.icon || "clipboard"
                ink: row.selected ? row.theme.colors.selection_foreground : row.theme.colors.foreground
            }
        }
        Loader {
            id: attachment
            readonly property ClipboardAttachment content: item as ClipboardAttachment
            active: row.loadAttachments && Boolean(row.entry.clipboard && row.entry.attachment)
            visible: content ? content.ready : false
            Layout.preferredWidth: visible ? 96 * row.textScale : 0
            Layout.preferredHeight: 64 * row.textScale
            sourceComponent: ClipboardAttachment { entryId: row.entry.id }
        }
        Label {
            objectName: "entryLabel"
            // Keep a useful fallback until the image has actually rendered.
            visible: !attachment.visible
            Layout.fillWidth: true
            color: row.selected ? row.theme.colors.selection_foreground : row.theme.colors.bright_foreground
            font.family: row.uiFont
            font.pointSize: row.textSize + 1
            font.weight: row.selected ? Font.Medium : Font.Normal
            elide: Text.ElideRight
            text: attachment.content && attachment.content.label ? attachment.content.label : row.entry.name
            textFormat: Text.PlainText
        }
        Item {
            visible: attachment.visible
            Layout.fillWidth: true
        }
        Label {
            objectName: "toggleState"
            visible: typeof row.entry.checked === "boolean"
            text: row.entry.checked ? "On" : "Off"
            color: row.selected ? row.theme.colors.selection_foreground : row.theme.colors.foreground
            font.family: row.uiFont
            font.pointSize: row.textSize
        }
        Label {
            visible: Boolean(row.entry.parentName) || (row.applicationEntry && !row.appsView)
            text: row.entry.parentName || "Apps"
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
