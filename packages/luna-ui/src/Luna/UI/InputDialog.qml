pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls.Basic as Controls
import QtQuick.Layouts
import "." as Components

// The caller handles submission and closes after success; errors keep the input available.
Controls.Dialog {
    id: dialog
    required property Components.Theme theme
    property string fieldLabel: ""
    property string placeholderText: ""
    property string actionText: "Add"
    property string errorMessage: ""
    property bool busy: false
    property alias text: input.text
    signal submitted(string value)
    modal: true
    focus: true
    width: Math.min(430, parent ? parent.width - 40 : 430)
    padding: 22
    closePolicy: Controls.Popup.CloseOnEscape
    enter: Transition {
        ParallelAnimation {
            NumberAnimation { property: "opacity"; from: 0; to: 1; duration: 140; easing.type: Easing.OutCubic }
            NumberAnimation { property: "scale"; from: 0.97; to: 1; duration: 160; easing.type: Easing.OutCubic }
        }
    }
    exit: Transition {
        ParallelAnimation {
            NumberAnimation { property: "opacity"; to: 0; duration: 100; easing.type: Easing.InCubic }
            NumberAnimation { property: "scale"; to: 0.98; duration: 100; easing.type: Easing.InCubic }
        }
    }
    onAboutToShow: { errorMessage = ""; input.clear(); input.forceActiveFocus(); }

    function submit() {
        if (!busy && input.text.trim() !== "") submitted(input.text.trim());
    }
    background: Rectangle {
        color: dialog.theme.surface
        radius: dialog.theme.rounding
        border.width: Math.max(1, dialog.theme.borderWidth)
        border.color: dialog.theme.line
    }
    Controls.Overlay.modal: Rectangle { color: Qt.alpha(dialog.theme.sidebar, 0.65) }
    header: Components.Title {
        theme: dialog.theme
        text: dialog.title
        padding: 22
        bottomPadding: 4
    }
    contentItem: ColumnLayout {
        spacing: 10
        Components.Text { theme: dialog.theme; text: dialog.fieldLabel; visible: text !== "" }
        Controls.TextField {
            id: input
            objectName: "dialogInput"
            Layout.fillWidth: true
            implicitHeight: 38
            placeholderText: dialog.placeholderText
            Accessible.name: dialog.fieldLabel || dialog.title
            selectByMouse: true
            readOnly: dialog.busy
            color: dialog.theme.text
            placeholderTextColor: dialog.theme.subtle
            font.family: dialog.theme.font
            font.pixelSize: 13
            onAccepted: dialog.submit()
            background: Rectangle {
                color: dialog.theme.raised
                radius: dialog.theme.rounding
                border.width: Math.max(1, dialog.theme.borderWidth)
                border.color: input.activeFocus ? dialog.theme.accent : dialog.theme.line
            }
        }
        Components.Text {
            objectName: "dialogError"
            theme: dialog.theme
            Layout.fillWidth: true
            visible: dialog.errorMessage !== ""
            text: dialog.errorMessage
            font.pixelSize: 12
            color: dialog.theme.error
        }
        RowLayout {
            Layout.fillWidth: true
            Layout.topMargin: 10
            spacing: 8
            Item { Layout.fillWidth: true }
            Components.Button { theme: dialog.theme; variant: Components.Button.Outline; text: "Cancel"; onClicked: dialog.close() }
            Components.Button {
                objectName: "dialogSubmit"
                theme: dialog.theme
                text: dialog.busy ? "Working…" : dialog.actionText
                enabled: !dialog.busy && input.text.trim() !== ""
                onClicked: dialog.submit()
            }
        }
    }
}
