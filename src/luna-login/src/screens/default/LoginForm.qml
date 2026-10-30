pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Effects
import QtQuick.Layouts

ColumnLayout {
    id: form
    required property var settings
    required property var login
    property color fieldColor: settings.colors.lighter_background
    readonly property string avatarSource: userSelector.currentIndex >= 0 && userSelector.editText === userSelector.currentText ? String(userSelector.currentValue || "") : ""
    spacing: 10

    function clearPassword() {
        // Assignment discards undo history; clear() alone can restore a password.
        if (password.text === "" && (password.canUndo || password.canRedo))
            password.text = " ";
        password.text = "";
    }

    function submit() {
        if (login.busy)
            return;
        const response = password.text;
        clearPassword();
        login.submit(userSelector.editText, response, login.selectedSession);
    }

    function focusInput() {
        if (userSelector.editText)
            password.forceActiveFocus(Qt.TabFocusReason);
        else
            userSelector.forceActiveFocus(Qt.TabFocusReason);
    }

    Connections {
        target: form.login
        function onAuthenticationFailed() {
            form.clearPassword();
            Qt.callLater(form.focusInput);
        }
        function onAuthenticationSucceeded() {
            form.clearPassword();
        }
    }

    Rectangle {
        id: avatar
        objectName: "userAvatar"
        Layout.alignment: Qt.AlignHCenter
        implicitWidth: 88
        implicitHeight: 88
        radius: width / 2
        color: form.settings.colors.accent
        Text {
            anchors.centerIn: parent
            visible: avatarImage.status !== Image.Ready
            text: (userSelector.editText || "?").charAt(0).toUpperCase()
            color: form.settings.colors.accent_foreground
            font.family: form.settings.fonts.ui
            font.pixelSize: 36
        }
        Rectangle {
            id: avatarMask
            anchors.fill: parent
            radius: width / 2
            color: "white"
            visible: false
            layer.enabled: true
        }
        Image {
            id: avatarImage
            objectName: "avatarImage"
            anchors.fill: parent
            source: form.avatarSource
            fillMode: Image.PreserveAspectCrop
            visible: status === Image.Ready
            asynchronous: true
            layer.enabled: true
            layer.effect: MultiEffect {
                maskEnabled: true
                maskSource: avatarMask
            }
        }
    }

    ComboBox {
        id: userSelector
        objectName: "userSelector"
        Layout.fillWidth: true
        implicitHeight: 36
        model: form.login.users
        textRole: "name"
        valueRole: "icon"
        editable: true
        enabled: !form.login.busy
        currentIndex: form.login.users ? form.login.users.lastIndex : -1
        font.family: form.settings.fonts.ui
        font.pixelSize: 16
        font.weight: Font.DemiBold
        palette.text: form.settings.colors.bright_foreground
        palette.base: form.settings.colors.background
        palette.window: form.settings.colors.background
        palette.highlight: form.settings.colors.selection
        palette.highlightedText: form.settings.colors.selection_foreground
        Accessible.name: qsTr("Username")
        inputMethodHints: Qt.ImhNoPredictiveText | Qt.ImhNoAutoUppercase
        Component.onCompleted: editText = form.login.selectedUser
        onEditTextChanged: {
            form.clearPassword();
            form.login.clearError();
        }
        onActivated: {
            form.login.selectedUser = editText;
            password.forceActiveFocus(Qt.TabFocusReason);
        }
        onAccepted: password.forceActiveFocus(Qt.TabFocusReason)
        background: null
        contentItem: TextField {
            text: userSelector.editText
            font: userSelector.font
            horizontalAlignment: Text.AlignHCenter
            color: form.settings.colors.bright_foreground
            selectionColor: form.settings.colors.selection
            selectedTextColor: form.settings.colors.selection_foreground
            background: null
            selectByMouse: true
            inputMethodHints: userSelector.inputMethodHints
        }
    }

    RowLayout {
        Layout.fillWidth: true
        spacing: 6
        TextField {
            id: password
            objectName: "passwordInput"
            Layout.fillWidth: true
            implicitHeight: 40
            enabled: !form.login.busy
            placeholderText: qsTr("Password")
            echoMode: TextInput.Password
            passwordMaskDelay: 0
            inputMethodHints: Qt.ImhSensitiveData | Qt.ImhHiddenText | Qt.ImhNoPredictiveText | Qt.ImhNoAutoUppercase
            color: form.settings.colors.foreground
            selectionColor: form.settings.colors.selection
            selectedTextColor: form.settings.colors.selection_foreground
            placeholderTextColor: form.settings.colors.foreground
            font.family: form.settings.fonts.ui
            font.pixelSize: 13
            Accessible.name: qsTr("Password")
            onAccepted: form.submit()
            onTextEdited: form.login.clearError()
            background: Rectangle {
                radius: Math.min(20, form.settings.appearance.rounding)
                color: Qt.rgba(form.fieldColor.r, form.fieldColor.g, form.fieldColor.b, form.settings.appearance.opacity.active)
                border.width: form.settings.appearance.border_width
                border.color: password.activeFocus ? form.settings.colors.accent : form.settings.colors.muted
            }
        }
        Button {
            id: submitButton
            objectName: "loginButton"
            implicitWidth: 40
            implicitHeight: 40
            enabled: !form.login.busy
            text: form.login.busy ? "…" : "→"
            Accessible.name: qsTr("Sign in")
            onClicked: form.submit()
            contentItem: Text {
                text: submitButton.text
                font.family: form.settings.fonts.ui
                font.pixelSize: 20
                color: form.settings.colors.accent_foreground
                horizontalAlignment: Text.AlignHCenter
                verticalAlignment: Text.AlignVCenter
            }
            background: Rectangle {
                color: form.settings.colors.accent
                radius: Math.min(20, form.settings.appearance.rounding)
                opacity: submitButton.enabled ? submitButton.down ? 0.65 : 0.9 : 0.5
                border.width: submitButton.visualFocus ? 2 : 0
                border.color: form.settings.colors.bright_foreground
            }
        }
    }

    Label {
        objectName: "capsLockWarning"
        Layout.fillWidth: true
        visible: form.login.capsLock
        text: qsTr("Caps Lock is on")
        horizontalAlignment: Text.AlignHCenter
        color: form.settings.colors.warning
        font.family: form.settings.fonts.ui
        font.pixelSize: 12
    }

    Label {
        objectName: "loginError"
        Layout.fillWidth: true
        visible: text !== ""
        text: form.login.errorMessage
        textFormat: Text.PlainText
        wrapMode: Text.Wrap
        horizontalAlignment: Text.AlignHCenter
        color: form.settings.colors.error
        font.family: form.settings.fonts.ui
        font.pixelSize: 12
        Accessible.role: Accessible.AlertMessage
    }

    Component.onDestruction: clearPassword()
}
