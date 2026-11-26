pragma ComponentBehavior: Bound

import QtQuick
import "."
import QtQuick.Controls.Basic

Item {
    id: form
    required property var lock
    property bool compact: false
    property bool passwordVisible: false
    readonly property var theme: lock.theme
    signal restRequested
    implicitHeight: identity.height + 68

    function clearPassword() {
        // Assignment discards Qt's undo/redo history as well as the visible secret.
        if (password.text === "" && (password.canUndo || password.canRedo))
            password.text = " ";
        password.text = "";
    }

    function revealPassword(initialText) {
        if (lock.actions?.shutdownActive)
            return;
        lock.activity();
        passwordVisible = true;
        if (!lock.busy)
            password.forceActiveFocus(Qt.OtherFocusReason);
        if (initialText && lock.responseRequired)
            password.insert(password.cursorPosition, initialText);
    }

    function dismiss() {
        clearPassword();
        passwordVisible = false;
        restRequested();
    }

    function submit() {
        lock.activity();
        if (lock.responseRequired) {
            const response = password.text;
            clearPassword();
            lock.submitted(response);
        } else if (lock.canRetry) {
            clearPassword();
            lock.retryRequested();
        }
    }

    Connections {
        target: form.lock
        function onInputCleared() {
            form.clearPassword();
        }
        function onResponseRequiredChanged() {
            if (form.passwordVisible && form.lock.responseRequired && form.lock.keyboardActive)
                password.forceActiveFocus(Qt.OtherFocusReason);
        }
        function onKeyboardActiveChanged() {
            if (!form.lock.keyboardActive) {
                form.clearPassword();
                form.passwordVisible = false;
            }
        }
    }

    LockIdentity {
        id: identity
        anchors.top: parent.top
        width: parent.width
        lock: form.lock
        compact: form.compact
        onRevealRequested: form.revealPassword("")
    }

    TextField {
        id: password
        objectName: "lock-password"
        anchors.top: identity.bottom
        anchors.topMargin: 22
        width: parent.width
        height: 46
        opacity: form.passwordVisible ? 1 : 0
        // Set visibility before the fade so the first typed character can take focus immediately.
        visible: form.passwordVisible || opacity > 0
        enabled: form.passwordVisible && !form.lock.busy
        readOnly: !form.lock.responseRequired
        Behavior on opacity {
            NumberAnimation {
                duration: 160
                easing.type: Easing.OutQuad
            }
        }
        leftPadding: 14
        rightPadding: 48
        echoMode: form.lock.responseVisible ? TextInput.Normal : TextInput.Password
        passwordMaskDelay: 0
        inputMethodHints: Qt.ImhSensitiveData | Qt.ImhNoPredictiveText | Qt.ImhNoAutoUppercase | (form.lock.responseVisible ? Qt.ImhNone : Qt.ImhHiddenText)
        selectByMouse: true
        hoverEnabled: true
        placeholderText: form.lock.statusText || form.lock.prompt || qsTr("Password")
        color: form.theme.colors.bright_foreground
        placeholderTextColor: form.lock.statusText ? form.theme.colors.error : Qt.alpha(form.theme.colors.foreground, 0.75)
        selectionColor: form.theme.colors.selection
        selectedTextColor: form.theme.colors.selection_foreground
        font.family: form.theme.fonts.ui
        font.pixelSize: 14
        Accessible.name: form.lock.prompt || qsTr("Password")
        Accessible.description: form.lock.busy ? qsTr("Authenticating…") : form.lock.statusText
        ToolTip.text: Accessible.description
        ToolTip.visible: hovered && ToolTip.text !== ""
        onAccepted: form.submit()
        onTextEdited: form.lock.activity()
        onActiveFocusChanged: if (activeFocus)
            form.lock.activity()
        Keys.onPressed: event => {
            form.lock.activity();
            if (event.key === Qt.Key_Escape) {
                form.dismiss();
                event.accepted = true;
            }
        }
        background: Rectangle {
            radius: form.theme.appearance.rounding
            color: Qt.alpha(form.theme.colors.lighter_background, 0.64)
            border.width: 1
            border.color: form.lock.statusText ? form.theme.colors.error : password.activeFocus ? Qt.alpha(form.theme.colors.accent, 0.55) : Qt.alpha(form.theme.colors.bright_foreground, 0.15)
            Behavior on border.color {
                ColorAnimation {
                    duration: 140
                }
            }
        }

        Button {
            id: submitButton
            objectName: "lock-submit"
            anchors.right: parent.right
            anchors.rightMargin: 4
            anchors.verticalCenter: parent.verticalCenter
            width: 38
            height: 38
            padding: 10
            hoverEnabled: true
            enabled: form.lock.responseRequired || form.lock.canRetry
            text: form.lock.canRetry ? qsTr("Retry") : qsTr("Unlock")
            Accessible.name: text
            onClicked: form.submit()
            onActiveFocusChanged: if (activeFocus)
                form.lock.activity()
            contentItem: Item {
                ScreenIcon {
                    anchors.fill: parent
                    visible: !form.lock.busy
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
                    visible: form.lock.busy
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
