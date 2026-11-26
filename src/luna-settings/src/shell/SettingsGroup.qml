pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls.Basic

Column {
    id: group
    required property var section
    required property MockState mockState
    required property SettingsTheme theme
    signal navigate(string page)
    signal reveal(Item target)
    spacing: 11

    function focusSetting(key) {
        for (let i = 0; i < rows.count; i++) {
            const item = rows.itemAt(i) as SettingsRow;
            if (item.entry.key === key || item.entry.page === key) {
                item.focusControl();
                return item;
            }
        }
        return null;
    }

    Label {
        objectName: "section-" + group.section.title
        visible: group.section.title !== ""
        text: group.section.title
        color: group.theme.text
        font.family: group.theme.font
        font.pixelSize: 15
        font.weight: Font.Medium
    }
    Rectangle {
        width: parent.width
        height: rowColumn.implicitHeight + 2 * group.theme.borderWidth
        color: "transparent"
        border.color: group.theme.line
        border.width: group.theme.borderWidth
        radius: group.theme.rounding

        Column {
            id: rowColumn
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.margins: group.theme.borderWidth
            Repeater {
                id: rows
                model: group.section.rows
                SettingsRow {
                    required property var modelData
                    required property int index
                    width: rowColumn.width
                    entry: modelData
                    page: group.section.page
                    mockState: group.mockState
                    theme: group.theme
                    separator: index < rows.count - 1
                    onNavigate: page => group.navigate(page)
                    onReveal: target => group.reveal(target)
                }
            }
        }
    }
}
