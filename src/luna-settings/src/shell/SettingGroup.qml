pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

ColumnLayout {
    id: group
    required property string title
    default property alias rows: entries.data
    spacing: 10

    Label {
        text: group.title
        font.pixelSize: 13
        font.weight: Font.DemiBold
        color: palette.placeholderText
        leftPadding: 2
    }
    Frame {
        id: panel
        Layout.fillWidth: true
        padding: 0
        background: Rectangle {
            radius: 14
            color: panel.palette.base
            border.color: panel.palette.mid
        }
        contentItem: ColumnLayout { id: entries; spacing: 0 }
    }
}
