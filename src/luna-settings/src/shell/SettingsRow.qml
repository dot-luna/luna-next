pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

FocusScope {
    id: row
    required property var entry
    required property MockState mockState
    required property SettingsTheme theme
    required property string page
    property bool separator: false
    property Item focusTarget: null
    // A row keeps its owning page while the repeater replaces the previous page's controls.
    readonly property var value: entry.key ? mockState.draft[page][entry.key] : null
    signal navigate(string page)
    signal reveal(Item target)

    objectName: "row-" + (entry.key || entry.page)
    implicitHeight: 58
    onActiveFocusChanged: if (activeFocus) reveal(row)

    function focusControl() {
        if (entry.type === "link") route.forceActiveFocus();
        else if (focusTarget) focusTarget.forceActiveFocus();
    }

    RowLayout {
        anchors.fill: parent
        anchors.leftMargin: 17
        anchors.rightMargin: 17
        spacing: 14

        SettingsIcon {
            visible: Boolean(row.entry.icon)
            name: row.entry.icon || "computer"
            ink: row.theme.subtle
        }
        Label {
            Layout.fillWidth: true
            text: row.entry.label
            font.family: row.theme.font
            font.pixelSize: 13
            color: row.theme.text
            wrapMode: Text.WordWrap
            textFormat: Text.PlainText
        }
        Loader {
            id: editor
            Layout.preferredWidth: row.entry.type === "link" ? 15 : row.entry.type === "toggle" ? 35 : 164
            Layout.preferredHeight: row.entry.type === "link" ? 15 : row.entry.type === "toggle" ? 21 : 34
            sourceComponent: row.entry.type === "select" ? selectEditor : row.entry.type === "toggle" ? toggleEditor
                : row.entry.type === "slider" ? sliderEditor : arrowEditor
        }
    }

    Button {
        id: route
        anchors.fill: parent
        visible: row.entry.type === "link"
        objectName: "link-" + (row.entry.page || "")
        text: row.entry.label
        hoverEnabled: true
        Accessible.name: text
        onClicked: row.navigate(row.entry.page)
        Keys.onReturnPressed: clicked()
        Keys.onEnterPressed: clicked()
        contentItem: Item {}
        background: Rectangle {
            color: route.hovered || route.visualFocus ? Qt.alpha(row.theme.accent, 0.07) : "transparent"
            border.width: route.visualFocus ? Math.max(1, row.theme.borderWidth) : 0
            border.color: row.theme.accent
            radius: row.theme.rounding
        }
    }

    Rectangle {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        visible: row.separator && row.theme.borderWidth > 0
        height: 1
        color: row.theme.line
    }

    Component {
        id: arrowEditor
        SettingsIcon { name: "arrow-right-01"; ink: row.theme.subtle }
    }
    Component {
        id: selectEditor
        ComboBox {
            id: combo
            Component.onCompleted: row.focusTarget = combo
            objectName: "control-" + row.entry.key
            model: row.entry.options
            currentIndex: row.entry.options.indexOf(row.value)
            font.family: row.theme.font
            font.pixelSize: 12
            Accessible.name: row.entry.label
            palette.base: row.theme.raised
            palette.window: row.theme.raised
            palette.text: row.theme.text
            palette.buttonText: row.theme.text
            palette.highlight: row.theme.selected
            palette.highlightedText: row.theme.selectedText
            onActivated: row.mockState.setValue(row.page, row.entry.key, currentText)
            contentItem: Text {
                text: combo.displayText
                font: combo.font
                color: row.theme.text
                verticalAlignment: Text.AlignVCenter
                elide: Text.ElideRight
                leftPadding: 9
                rightPadding: 19
                textFormat: Text.PlainText
            }
            indicator: SettingsIcon {
                x: combo.width - 19
                y: (combo.height - height) / 2
                width: 12
                height: 12
                rotation: 90
                name: "arrow-right-01"
                ink: row.theme.subtle
            }
            background: Rectangle {
                radius: row.theme.rounding
                color: row.theme.raised
                border.width: combo.visualFocus ? Math.max(1, row.theme.borderWidth) : row.theme.borderWidth
                border.color: combo.visualFocus ? row.theme.accent : row.theme.line
            }
            popup.background: Rectangle { color: row.theme.raised; radius: row.theme.rounding; border.width: row.theme.borderWidth; border.color: row.theme.line }
        }
    }
    Component {
        id: toggleEditor
        Switch {
            id: toggle
            Component.onCompleted: row.focusTarget = toggle
            objectName: "control-" + row.entry.key
            checked: row.value === true
            padding: 0
            Accessible.name: row.entry.label
            onToggled: row.mockState.setValue(row.page, row.entry.key, checked)
            contentItem: Item {}
            indicator: Rectangle {
                implicitWidth: 35
                implicitHeight: 21
                radius: row.theme.rounding
                color: toggle.checked ? row.theme.accent : row.theme.raised
                border.color: toggle.visualFocus ? row.theme.text : toggle.checked ? row.theme.accent : row.theme.line
                border.width: toggle.visualFocus ? Math.max(1, row.theme.borderWidth) : row.theme.borderWidth
                Rectangle {
                    x: toggle.checked ? 18 : 4
                    y: 4
                    width: 13
                    height: 13
                    radius: 7
                    color: toggle.checked ? row.theme.accentText : row.theme.subtle
                    Behavior on x { NumberAnimation { duration: 90 } }
                }
                Behavior on color { ColorAnimation { duration: 90 } }
            }
        }
    }
    Component {
        id: sliderEditor
        RowLayout {
            spacing: 10
            Slider {
                id: slider
                Component.onCompleted: row.focusTarget = slider
                objectName: "control-" + row.entry.key
                Layout.fillWidth: true
                from: 0
                to: row.entry.max
                stepSize: 1
                value: Number(row.value)
                Accessible.name: row.entry.label
                onMoved: row.mockState.setValue(row.page, row.entry.key, value)
                background: Rectangle {
                    x: slider.leftPadding
                    y: (slider.height - height) / 2
                    width: slider.availableWidth
                    height: 3
                    radius: 2
                    color: row.theme.line
                    Rectangle { width: slider.visualPosition * parent.width; height: parent.height; radius: 2; color: row.theme.accent }
                }
                handle: Rectangle {
                    x: slider.leftPadding + slider.visualPosition * (slider.availableWidth - width)
                    y: (slider.height - height) / 2
                    width: 13
                    height: 13
                    radius: 7
                    color: row.theme.accent
                    border.width: slider.visualFocus ? 2 : 0
                    border.color: row.theme.text
                }
            }
            Label {
                Layout.preferredWidth: 36
                text: row.value + " px"
                color: row.theme.subtle
                font.family: row.theme.font
                font.pixelSize: 12
                horizontalAlignment: Text.AlignRight
            }
        }
    }
}
