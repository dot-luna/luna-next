pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

Dialog {
    id: dialog
    required property SettingsTheme theme
    required property MockState mockState
    property string errorMessage: ""
    objectName: "themeRepositoryDialog"
    modal: true
    focus: true
    width: Math.min(430, parent ? parent.width - 40 : 430)
    padding: 22
    closePolicy: Popup.CloseOnEscape
    onOpened: { errorMessage = ""; repository.clear(); repository.forceActiveFocus(); }

    function submit() {
        errorMessage = mockState.addTheme(repository.text);
        if (!errorMessage) close();
    }

    background: Rectangle { color: dialog.theme.surface; radius: dialog.theme.rounding; border.width: Math.max(1, dialog.theme.borderWidth); border.color: dialog.theme.line }
    Overlay.modal: Rectangle { color: Qt.alpha(dialog.theme.sidebar, 0.65) }
    header: Label {
        text: "Add Theme"
        padding: 22
        bottomPadding: 4
        font.family: dialog.theme.font
        font.pixelSize: 19
        font.weight: Font.Medium
        color: dialog.theme.text
    }
    contentItem: ColumnLayout {
        spacing: 10
        Label { text: "Repository URL"; font.family: dialog.theme.font; font.pixelSize: 13; color: dialog.theme.text }
        TextField {
            id: repository
            objectName: "themeRepositoryUrl"
            Layout.fillWidth: true
            implicitHeight: 38
            placeholderText: "https://github.com/user/theme"
            Accessible.name: "Theme repository URL"
            selectByMouse: true
            color: dialog.theme.text
            placeholderTextColor: dialog.theme.subtle
            font.family: dialog.theme.font
            font.pixelSize: 13
            onAccepted: dialog.submit()
            background: Rectangle { color: dialog.theme.raised; radius: dialog.theme.rounding; border.color: repository.activeFocus ? dialog.theme.accent : dialog.theme.line }
        }
        Label {
            objectName: "themeRepositoryError"
            Layout.fillWidth: true
            visible: dialog.errorMessage !== ""
            text: dialog.errorMessage
            wrapMode: Text.WordWrap
            font.family: dialog.theme.font
            font.pixelSize: 12
            color: dialog.theme.error
        }
        RowLayout {
            Layout.fillWidth: true
            Layout.topMargin: 10
            spacing: 8
            Item { Layout.fillWidth: true }
            SettingsButton { theme: dialog.theme; text: "Cancel"; onClicked: dialog.close() }
            SettingsButton { objectName: "confirmAddTheme"; theme: dialog.theme; text: "Add"; primary: true; onClicked: dialog.submit() }
        }
    }
}
