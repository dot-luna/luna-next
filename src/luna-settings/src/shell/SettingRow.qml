pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

Item {
    id: row
    required property string title
    property string description: ""
    property bool divided: false
    default property alias actions: trailing.data
    Layout.fillWidth: true
    implicitHeight: Math.max(description ? 80 : 62, labels.implicitHeight + 28)

    Rectangle {
        visible: row.divided
        anchors { left: parent.left; right: parent.right; top: parent.top; leftMargin: 18; rightMargin: 18 }
        height: 1
        color: titleLabel.palette.mid
    }
    RowLayout {
        anchors.fill: parent
        spacing: 20
        ColumnLayout {
            id: labels
            Layout.fillWidth: true
            Layout.leftMargin: 20
            Layout.topMargin: 14
            Layout.bottomMargin: 14
            spacing: 5
            Label { id: titleLabel; text: row.title; Layout.fillWidth: true; wrapMode: Text.WordWrap }
            Label {
                visible: row.description !== ""
                text: row.description
                color: palette.placeholderText
                font.pixelSize: 12
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
            }
        }
        RowLayout { id: trailing; Layout.rightMargin: 20; spacing: 10 }
    }
}
