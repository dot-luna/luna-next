pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls.Basic as Controls
import QtQuick.Layouts
import "." as Components

// The caller handles submission and closes after success; errors keep the input available.
Components.Dialog {
    id: dialog
    property string fieldLabel: ""
    property string placeholderText: ""
    property string actionText: "Add"
    property string errorMessage: ""
    property bool busy: false
    property alias text: input.text
    signal submitted(string value)
    onAboutToShow: { errorMessage = ""; input.clear(); input.forceActiveFocus(); }

    function submit() {
        if (!busy && input.text.trim() !== "") submitted(input.text.trim());
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
