pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls.Basic

Item {
    id: preview
    required property var entry
    required property var theme
    required property string uiFont
    required property real textSize
    property bool loading: false
    property string error: ""

    Image {
        objectName: "clipboardImage"
        anchors.fill: parent
        source: preview.entry.image || ""
        fillMode: Image.PreserveAspectFit
        visible: source.toString() !== ""
        asynchronous: true
    }
    ScrollView {
        anchors.fill: parent
        visible: !preview.entry.image && Boolean(preview.entry.text)
        contentWidth: availableWidth
        TextArea {
            text: preview.entry.text || ""
            textFormat: TextEdit.PlainText
            readOnly: true
            selectByMouse: true
            activeFocusOnPress: false
            wrapMode: TextEdit.Wrap
            font.family: preview.uiFont
            font.pointSize: preview.textSize
            color: preview.theme.colors.bright_foreground
            background: Item {}
            Accessible.name: "Clipboard preview"
        }
    }
    Label {
        anchors.centerIn: parent
        visible: !preview.entry.id
        text: preview.error || (preview.loading ? "Loading…" : "")
        color: preview.theme.colors.foreground
        font.family: preview.uiFont
        font.pointSize: preview.textSize
    }
}
