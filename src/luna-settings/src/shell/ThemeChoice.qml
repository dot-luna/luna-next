pragma ComponentBehavior: Bound

import QtQuick
import Luna.UI 1.0 as UI
import QtQuick.Layouts

UI.Button {
    variant: UI.Button.Ghost
    id: choice
    required property var entry
    required property bool selected
    required property bool applied
    signal chosen()
    signal removed()
    signal reveal(Item target)
    objectName: "theme-" + entry.name
    implicitHeight: 174
    padding: 7
    hoverEnabled: true
    Accessible.name: entry.name + ", " + (entry.mode === "light" ? "Light" : "Dark")
    Accessible.description: "Palette: " + entry.palette.join(", ")
    onClicked: chosen()
    onActiveFocusChanged: if (activeFocus) reveal(choice)

    background: Rectangle {
        color: choice.hovered ? choice.theme.raised : "transparent"
        radius: choice.theme.rounding
        border.width: choice.selected || choice.visualFocus ? 2 : choice.theme.borderWidth
        border.color: choice.selected || choice.visualFocus ? choice.theme.accent : choice.theme.line
    }
    contentItem: ColumnLayout {
        spacing: 9
        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            color: choice.entry.background
            radius: choice.theme.rounding
            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 9
                spacing: 9
                Item {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    Rectangle {
                        x: parent.width * 0.32
                        y: 2
                        width: parent.width * 0.6
                        height: parent.height * 0.76
                        radius: choice.theme.rounding * 0.4
                        color: choice.entry.dark
                    }
                    Rectangle {
                        x: parent.width * 0.09
                        y: parent.height * 0.18
                        width: parent.width * 0.7
                        height: parent.height * 0.78
                        radius: choice.theme.rounding * 0.4
                        color: choice.entry.raised
                        border.width: 1
                        border.color: Qt.alpha(choice.entry.foreground, 0.12)
                        Rectangle {
                            x: 8
                            y: 8
                            width: parent.width * 0.57
                            height: 7
                            radius: choice.theme.rounding * 0.2
                            color: choice.entry.accent
                        }
                        Rectangle {
                            x: 8
                            y: 23
                            width: parent.width * 0.7
                            height: 3
                            color: Qt.alpha(choice.entry.foreground, 0.4)
                        }
                        Rectangle {
                            x: 8
                            y: 32
                            width: parent.width * 0.46
                            height: 3
                            color: Qt.alpha(choice.entry.foreground, 0.22)
                        }
                        Rectangle {
                            anchors.right: parent.right
                            anchors.bottom: parent.bottom
                            anchors.margins: 8
                            width: parent.width * 0.3
                            height: 12
                            radius: choice.theme.rounding * 0.2
                            color: choice.entry.accent
                        }
                    }
                }
                RowLayout {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 14
                    Layout.maximumHeight: 14
                    spacing: 4
                    Rectangle {
                        objectName: "palette-" + choice.entry.name + "-0"
                        Layout.fillWidth: true
                        Layout.preferredWidth: 3
                        Layout.fillHeight: true
                        radius: choice.theme.rounding * 0.2
                        color: choice.entry.accent
                    }
                    Repeater {
                        model: choice.entry.palette.slice(1)
                        Rectangle {
                            required property string modelData
                            required property int index
                            objectName: "palette-" + choice.entry.name + "-" + (index + 1)
                            Layout.fillWidth: true
                            Layout.preferredWidth: 1
                            Layout.fillHeight: true
                            radius: choice.theme.rounding * 0.2
                            color: modelData
                        }
                    }
                }
            }
        }
        RowLayout {
            Layout.fillWidth: true
            Layout.leftMargin: 3
            Layout.rightMargin: 3
            UI.Text {
                theme: choice.theme
                Layout.fillWidth: true
                text: choice.entry.name
                font.pixelSize: 12
                elide: Text.ElideRight
            }
            SettingsIcon {
                objectName: "theme-mode-" + choice.entry.name
                name: choice.entry.mode === "light" ? "sun-03" : "moon-02"
                ink: choice.theme.subtle
                Layout.preferredWidth: 15
                Layout.preferredHeight: 15
                Accessible.ignored: true
            }
        }
    }
    UI.Badge {
        objectName: "applied-theme-" + choice.entry.name
        theme: choice.theme
        visible: choice.applied
        text: "Applied"
        z: 2
        anchors.top: parent.top
        anchors.left: parent.left
        anchors.margins: 12
    }
    ChoiceDeleteButton {
        id: remove
        objectName: "delete-theme-" + choice.entry.name
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 12
        theme: choice.theme
        applied: choice.applied
        cardHovered: choice.hovered
        cardFocused: choice.visualFocus
        text: "Delete " + choice.entry.name
        onClicked: choice.removed()
        onActiveFocusChanged: if (activeFocus) choice.reveal(choice)
    }
}
