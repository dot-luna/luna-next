pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls.Basic

Button {
    id: choice
    required property var entry
    required property SettingsTheme theme
    required property bool selected
    required property bool applied
    signal chosen()
    signal removed()
    signal reveal(Item target)
    objectName: "background-" + entry.name
    implicitHeight: width * 0.64
    padding: 6
    hoverEnabled: true
    Accessible.name: entry.name + (applied ? ", applied" : "")
    ToolTip.visible: hovered || visualFocus
    ToolTip.text: entry.name
    ToolTip.delay: 400
    onClicked: chosen()
    onActiveFocusChanged: if (activeFocus) reveal(choice)
    Keys.onReturnPressed: clicked()
    Keys.onEnterPressed: clicked()
    background: Rectangle {
        radius: choice.theme.rounding
        color: choice.theme.raised
        border.width: choice.selected || choice.visualFocus ? 2 : choice.theme.borderWidth
        border.color: choice.selected || choice.visualFocus ? choice.theme.accent : choice.theme.line
    }
    contentItem: Image {
        source: choice.entry.source
        sourceSize: Qt.size(480, 300)
        fillMode: Image.PreserveAspectCrop
        asynchronous: true
        clip: true
    }
    ChoiceDeleteButton {
        objectName: "delete-background-" + choice.entry.name
        anchors.top: parent.top
        anchors.right: parent.right
        anchors.margins: 12
        theme: choice.theme
        applied: choice.applied
        cardHovered: choice.hovered
        cardFocused: choice.visualFocus
        text: "Delete " + choice.entry.name
        onClicked: choice.removed()
        onActiveFocusChanged: if (activeFocus) choice.reveal(choice)
    }
    Rectangle {
        z: 2
        anchors.left: parent.left
        anchors.bottom: parent.bottom
        anchors.margins: 12
        visible: choice.applied
        width: appliedLabel.implicitWidth + 14
        height: 24
        color: choice.theme.surface
        radius: choice.theme.rounding
        Label {
            id: appliedLabel
            anchors.centerIn: parent
            text: "Applied"
            font.family: choice.theme.font
            font.pixelSize: 11
            color: choice.theme.text
        }
    }
}
