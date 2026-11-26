pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic

Item {
    id: form
    required property var settings
    required property var login
    property bool compact: false
    property bool passwordVisible: false
    readonly property var theme: settings.theme
    signal restRequested
    implicitHeight: identity.height + 68

    function clearPassword() {
        // Assignment also discards undo history; clear() can leave a password recoverable.
        if (password.text === "" && (password.canUndo || password.canRedo))
            password.text = " ";
        password.text = "";
    }

    function revealPassword(initialText) {
        if (login.busy || !login.selectedUser)
            return;
        passwordVisible = true;
        password.forceActiveFocus(Qt.OtherFocusReason);
        if (initialText)
            password.insert(password.cursorPosition, initialText);
    }

    function moveUser(direction) {
        return identity.moveUser(direction);
    }

    function dismiss() {
        if (login.busy)
            return;
        clearPassword();
        passwordVisible = false;
        login.clearError();
        restRequested();
    }

    function submit() {
        if (login.busy)
            return;
        const response = password.text;
        clearPassword();
        login.submit(login.selectedUser, response);
    }

    Connections {
        target: form.login
        function onAuthenticationFailed() {
            form.clearPassword();
            if (form.passwordVisible)
                password.forceActiveFocus(Qt.OtherFocusReason);
        }
        function onAuthenticationSucceeded() {
            form.clearPassword();
        }
        function onSelectedUserChanged() {
            form.dismiss();
        }
        function onCurrentLayoutChanged() {
            form.clearPassword();
            if (form.passwordVisible)
                password.forceActiveFocus(Qt.OtherFocusReason);
        }
    }

    UserSwitcher {
        id: identity
        anchors.top: parent.top
        width: parent.width
        theme: form.theme
        login: form.login
        compact: form.compact
        switchingEnabled: !form.passwordVisible
        onRevealRequested: form.revealPassword("")
    }

    TextField {
        id: password
        objectName: "passwordInput"
        anchors.top: identity.bottom
        anchors.topMargin: 22
        width: parent.width
        height: 46
        opacity: form.passwordVisible ? 1 : 0
        // Keep the item visible on entry so the first keystroke receives focus immediately.
        visible: form.passwordVisible || opacity > 0
        enabled: form.passwordVisible && !form.login.busy
        Behavior on opacity {
            NumberAnimation {
                duration: 160
                easing.type: Easing.OutQuad
            }
        }
        leftPadding: 14
        rightPadding: 48
        echoMode: TextInput.Password
        passwordMaskDelay: 0
        placeholderText: form.login.errorMessage || (form.login.capsLock ? qsTr("Password · Caps Lock is on") : qsTr("Password"))
        color: form.theme.colors.bright_foreground
        placeholderTextColor: form.login.errorMessage ? form.theme.colors.error : Qt.alpha(form.theme.colors.foreground, 0.75)
        selectionColor: form.theme.colors.selection
        selectedTextColor: form.theme.colors.selection_foreground
        font.family: form.theme.fonts.ui
        font.pixelSize: 14
        selectByMouse: true
        hoverEnabled: true
        inputMethodHints: Qt.ImhSensitiveData | Qt.ImhHiddenText | Qt.ImhNoPredictiveText | Qt.ImhNoAutoUppercase
        Accessible.name: qsTr("Password")
        Accessible.description: form.login.errorMessage || (form.login.capsLock ? qsTr("Caps Lock is on") : "")
        ToolTip.text: Accessible.description
        ToolTip.visible: hovered && ToolTip.text !== ""
        onAccepted: form.submit()
        onTextEdited: form.login.clearError()
        background: Rectangle {
            radius: form.theme.appearance.rounding
            color: Qt.alpha(form.theme.colors.lighter_background, 0.64)
            border.width: 1
            border.color: form.login.errorMessage ? form.theme.colors.error : form.login.capsLock ? form.theme.colors.warning : password.activeFocus ? Qt.alpha(form.theme.colors.accent, 0.55) : Qt.alpha(form.theme.colors.bright_foreground, 0.15)
            Behavior on border.color {
                ColorAnimation {
                    duration: 140
                }
            }
        }
        Button {
            id: submitButton
            objectName: "loginButton"
            anchors.right: parent.right
            anchors.rightMargin: 4
            anchors.verticalCenter: parent.verticalCenter
            width: 38
            height: 38
            padding: 10
            hoverEnabled: true
            Accessible.name: qsTr("Sign in")
            onClicked: form.submit()
            contentItem: Item {
                LoginIcon {
                    anchors.fill: parent
                    visible: !form.login.busy
                    name: "arrow-right-01"
                    ink: form.theme.colors.foreground
                    opacity: submitButton.down ? 0.6 : 1
                    Behavior on opacity {
                        NumberAnimation {
                            duration: 90
                        }
                    }
                }
                BusyIndicator {
                    anchors.centerIn: parent
                    width: 22
                    height: 22
                    visible: form.login.busy
                    running: visible
                    palette.dark: form.theme.colors.foreground
                }
            }
            background: Rectangle {
                radius: form.theme.appearance.rounding
                color: submitButton.down ? Qt.alpha(form.theme.colors.selection, 0.95) : submitButton.hovered || submitButton.visualFocus ? Qt.alpha(form.theme.colors.selection, 0.6) : "transparent"
                border.width: submitButton.visualFocus ? 1 : 0
                border.color: form.theme.colors.accent
                Behavior on color {
                    ColorAnimation {
                        duration: 110
                    }
                }
            }
        }
    }

    Component.onDestruction: clearPassword()
}
