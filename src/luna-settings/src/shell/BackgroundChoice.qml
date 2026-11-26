pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Effects
import Luna.UI 1.0 as UI

UI.Button {
    id: choice
    required property var entry
    readonly property bool applied: entry.current
    signal chosen()
    signal removed()
    signal reveal(Item target)
    variant: UI.Button.Ghost
    objectName: "background-" + entry.name
    implicitHeight: width * 0.64
    padding: 0
    horizontalPadding: 0
    verticalPadding: 0
    Accessible.name: entry.name + (applied ? ", applied" : "")
    onClicked: chosen()
    onActiveFocusChanged: if (activeFocus) reveal(choice)
    background: Rectangle {
        radius: choice.theme.rounding
        color: choice.theme.raised
    }
    Rectangle {
        z: 1
        anchors.fill: parent
        radius: choice.theme.rounding
        color: "transparent"
        border.width: choice.applied || choice.visualFocus ? 2 : choice.theme.borderWidth
        border.color: choice.applied || choice.visualFocus ? choice.theme.accent : choice.theme.line
    }
    contentItem: Item {
        Image {
            id: preview
            objectName: "backgroundPreview"
            anchors.fill: parent
            source: choice.entry.video ? "" : choice.entry.source
            sourceSize: Qt.size(480, 300)
            fillMode: Image.PreserveAspectCrop
            asynchronous: true
            clip: true
            layer.enabled: choice.theme.rounding > 0
            layer.effect: MultiEffect { maskEnabled: true; maskSource: imageMask }
        }
        Rectangle {
            id: imageMask
            anchors.fill: preview
            radius: choice.theme.rounding
            color: "white"
            layer.enabled: true
            visible: false
        }
        UI.Text {
            anchors.centerIn: parent
            width: parent.width - 12
            theme: choice.theme
            visible: Boolean(choice.entry.video)
            text: choice.entry.name
            elide: Text.ElideMiddle
            wrapMode: Text.NoWrap
            horizontalAlignment: Text.AlignHCenter
        }
    }
    UI.Button {
        id: remove
        z: 2
        objectName: "delete-background-" + choice.entry.name
        anchors.top: parent.top
        anchors.right: parent.right
        anchors.margins: 10
        width: 28; height: 28
        theme: choice.theme
        variant: UI.Button.Ghost
        padding: 5
        horizontalPadding: 5
        verticalPadding: 5
        visible: !choice.applied
        opacity: choice.hovered || choice.visualFocus || hovered || visualFocus ? 1 : 0
        Accessible.name: "Delete " + choice.entry.name
        onClicked: choice.removed()
        onActiveFocusChanged: if (activeFocus) choice.reveal(choice)
        contentItem: SettingsIcon { name: "delete-02"; ink: choice.theme.error }
        background: Rectangle {
            color: "transparent"
            radius: choice.theme.rounding
            border.width: remove.visualFocus ? 1 : 0
            border.color: choice.theme.error
        }
    }
    UI.Badge {
        z: 2
        objectName: "applied-background-" + choice.entry.name
        anchors.left: parent.left
        anchors.bottom: parent.bottom
        anchors.margins: 12
        visible: choice.applied
        theme: choice.theme
        variant: UI.Badge.Secondary
        text: "Applied"
    }
}
