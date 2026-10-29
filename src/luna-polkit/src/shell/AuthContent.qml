pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

// Responses go directly to Quickshell's native polkit conversation, never CLI IPC.
Rectangle {
    id: card

    required property var theme
    property var flow: null
    property bool submitted: false
    property string failure: ""
    readonly property bool responding: flow !== null && !flow.isCompleted && flow.isResponseRequired && !submitted
    readonly property var identities: flow ? flow.identities : []
    readonly property string feedback: flow && flow.supplementaryMessage ? flow.supplementaryMessage : failure
    signal focusMoved(Item control)

    implicitWidth: 420
    implicitHeight: content.implicitHeight + 48
    color: card.theme.colors.background
    radius: Math.min(18, card.theme.appearance.rounding)
    border.width: Math.max(1, card.theme.appearance.border_width)
    border.color: card.theme.colors.muted

    function identityName(identity) {
        if (!identity)
            return "";
        const account = identity.string || String(identity.id);
        return identity.displayName && identity.displayName !== account
            ? identity.displayName + " (" + account + ")" : account;
    }

    function focusInput() {
        if (!flow || flow.isCompleted)
            return;
        if (responding)
            input.forceActiveFocus(Qt.TabFocusReason);
        else
            cancelButton.forceActiveFocus(Qt.TabFocusReason);
    }

    function clearResponse() {
        // clear() is undoable, and assigning an already-empty string does nothing.
        // Force a setter change in that case to discard both undo and redo history.
        if (input.text === "" && (input.canUndo || input.canRedo))
            input.text = " ";
        input.text = "";
    }

    function resetResponse() {
        clearResponse();
        submitted = false;
        Qt.callLater(focusInput);
    }

    function submitResponse() {
        if (!responding)
            return;
        const current = flow;
        const response = input.text;
        submitted = true;
        clearResponse();
        failure = "";
        current.submit(response);
    }

    function cancel() {
        clearResponse();
        submitted = true;
        if (flow && !flow.isCompleted)
            flow.cancelAuthenticationRequest();
    }

    function selectIdentity(index) {
        if (!flow || index < 0 || index >= identities.length)
            return;
        clearResponse();
        failure = "";
        flow.selectedIdentity = identities[index];
    }

    onFlowChanged: {
        failure = "";
        resetResponse();
        reveal.restart();
    }
    Component.onCompleted: Qt.callLater(focusInput)
    Keys.onEscapePressed: event => {
        cancel();
        event.accepted = true;
    }

    // Clear between PAM turns and requests so a later visible challenge cannot
    // restore a prior password.
    Connections {
        target: card.flow
        function onIsResponseRequiredChanged() { card.resetResponse(); }
        function onSelectedIdentityChanged() {
            card.failure = "";
            card.resetResponse();
        }
        function onIsCompletedChanged() { if (card.flow.isCompleted) card.clearResponse(); }
        function onAuthenticationFailed() {
            card.failure = "Authentication failed. Please try again.";
            card.resetResponse();
        }
        function onAuthenticationSucceeded() { card.clearResponse(); }
        function onAuthenticationRequestCancelled() { card.clearResponse(); }
    }

    NumberAnimation {
        id: reveal
        target: content
        property: "opacity"
        from: 0
        to: 1
        duration: 130
    }

    component AuthButton: Button {
        id: button
        property bool primary: false
        focusPolicy: Qt.StrongFocus
        implicitHeight: 40
        leftPadding: 16
        rightPadding: 16
        Accessible.name: text
        contentItem: Text {
            text: button.text
            textFormat: Text.PlainText
            color: button.primary ? card.theme.colors.accent_foreground : card.theme.colors.foreground
            font.family: card.theme.fonts.ui
            font.pixelSize: 13
            font.weight: Font.Medium
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
            opacity: button.enabled ? 1 : 0.5
        }
        background: Rectangle {
            radius: Math.min(9, card.theme.appearance.rounding)
            color: button.primary ? card.theme.colors.accent : button.hovered ? card.theme.colors.selection : card.theme.colors.lighter_background
            opacity: !button.enabled ? 0.45 : button.down ? 0.75 : button.primary && button.hovered ? 0.9 : 1
            border.width: button.visualFocus ? 2 : 0
            border.color: card.theme.colors.bright_foreground
            Behavior on color { ColorAnimation { duration: 100 } }
            Behavior on opacity { NumberAnimation { duration: 100 } }
        }
        Keys.onReturnPressed: click()
        Keys.onEnterPressed: click()
    }

    ColumnLayout {
        id: content
        anchors { top: parent.top; left: parent.left; right: parent.right; margins: 24 }
        spacing: 16

        RowLayout {
            spacing: 10
            AuthIcon {
                name: "lock"
                ink: card.theme.colors.accent
                implicitWidth: 20
                implicitHeight: 20
            }
            Label {
                Layout.fillWidth: true
                text: "Authenticate"
                color: card.theme.colors.bright_foreground
                font.family: card.theme.fonts.ui
                font.pixelSize: 18
                font.weight: Font.DemiBold
            }
        }

        Label {
            Layout.fillWidth: true
            text: card.flow ? card.flow.message : ""
            textFormat: Text.PlainText
            wrapMode: Text.Wrap
            color: card.theme.colors.foreground
            font.family: card.theme.fonts.ui
            font.pixelSize: 13
        }

        ColumnLayout {
            Layout.fillWidth: true
            spacing: 8
            ComboBox {
                id: identitySelector
                property bool openOnEnterRelease: false
                objectName: "identitySelector"
                Layout.fillWidth: true
                visible: card.identities.length > 1
                enabled: card.flow !== null && !card.flow.isCompleted
                model: Array.from(card.identities, identity => card.identityName(identity))
                currentIndex: card.flow ? Array.from(card.identities).indexOf(card.flow.selectedIdentity) : -1
                onActivated: index => card.selectIdentity(index)
                implicitHeight: 40
                rightPadding: 40
                font.family: card.theme.fonts.ui
                font.pixelSize: 13
                palette.button: card.theme.colors.lighter_background
                palette.buttonText: card.theme.colors.foreground
                palette.base: card.theme.colors.background
                palette.window: card.theme.colors.background
                palette.text: card.theme.colors.foreground
                palette.highlight: card.theme.colors.selection
                palette.highlightedText: card.theme.colors.selection_foreground
                palette.windowText: card.theme.colors.foreground
                palette.mid: card.theme.colors.muted
                palette.dark: card.theme.colors.foreground
                indicator: AuthIcon {
                    name: "chevron-right"
                    ink: card.theme.colors.foreground
                    implicitWidth: 14
                    implicitHeight: 14
                    x: identitySelector.width - width - 12
                    y: (identitySelector.height - height) / 2
                    rotation: identitySelector.popup.visible ? -90 : 90
                    Behavior on rotation { NumberAnimation { duration: 100 } }
                }
                background: Rectangle {
                    radius: Math.min(9, card.theme.appearance.rounding)
                    color: identitySelector.hovered || identitySelector.down ? card.theme.colors.selection : card.theme.colors.lighter_background
                    border.width: 1
                    border.color: identitySelector.visualFocus ? card.theme.colors.accent : card.theme.colors.muted
                    Behavior on color { ColorAnimation { duration: 100 } }
                }
                Accessible.name: "Authenticate as"
                onActiveFocusChanged: {
                    if (activeFocus)
                        card.focusMoved(identitySelector);
                    else
                        openOnEnterRelease = false;
                }
                KeyNavigation.tab: input.enabled ? input : cancelButton
                KeyNavigation.backtab: authenticateButton.enabled ? authenticateButton : cancelButton
                Keys.onReturnPressed: event => {
                    if (!popup.visible)
                        openOnEnterRelease = true;
                    else
                        event.accepted = false;
                }
                Keys.onEnterPressed: event => {
                    if (!popup.visible)
                        openOnEnterRelease = true;
                    else
                        event.accepted = false;
                }
                Keys.onReleased: event => {
                    // Opening on press lets Qt's release handler immediately select and close.
                    if (openOnEnterRelease && (event.key === Qt.Key_Return || event.key === Qt.Key_Enter)) {
                        openOnEnterRelease = false;
                        popup.open();
                        event.accepted = true;
                    }
                }
                Keys.onPressed: event => {
                    if (event.key === Qt.Key_Down && (event.modifiers & Qt.AltModifier)) {
                        popup.open();
                        event.accepted = true;
                    }
                }
            }
            RowLayout {
                Layout.fillWidth: true
                visible: card.flow !== null && card.flow.isResponseRequired
                spacing: 12
                Label {
                    Layout.fillWidth: true
                    text: card.flow ? card.flow.inputPrompt : ""
                    textFormat: Text.PlainText
                    wrapMode: Text.Wrap
                    color: card.theme.colors.foreground
                    font.family: card.theme.fonts.ui
                    font.pixelSize: 12
                }
                Label {
                    Layout.maximumWidth: parent.width / 2
                    visible: card.identities.length === 1
                    text: card.flow && card.flow.selectedIdentity ? card.flow.selectedIdentity.string : ""
                    textFormat: Text.PlainText
                    elide: Text.ElideRight
                    color: card.theme.colors.foreground
                    font.family: card.theme.fonts.ui
                    font.pixelSize: 12
                    Accessible.name: "Account: " + text
                }
            }
            TextField {
                id: input
                objectName: "responseInput"
                Layout.fillWidth: true
                implicitHeight: 44
                enabled: card.responding
                echoMode: card.flow && card.flow.responseVisible ? TextInput.Normal : TextInput.Password
                passwordMaskDelay: 0
                inputMethodHints: Qt.ImhSensitiveData | Qt.ImhNoPredictiveText | Qt.ImhNoAutoUppercase
                    | (echoMode === TextInput.Password ? Qt.ImhHiddenText : 0)
                selectByMouse: true
                color: card.theme.colors.bright_foreground
                selectionColor: card.theme.colors.selection
                selectedTextColor: card.theme.colors.selection_foreground
                font.family: card.theme.fonts.ui
                font.pixelSize: 14
                padding: 12
                Accessible.name: card.flow ? card.flow.inputPrompt : "Authentication response"
                onActiveFocusChanged: if (activeFocus) card.focusMoved(input)
                background: Rectangle {
                    radius: Math.min(9, card.theme.appearance.rounding)
                    color: card.theme.colors.lighter_background
                    border.width: 1
                    border.color: input.activeFocus ? card.theme.colors.accent : card.theme.colors.muted
                    Behavior on border.color { ColorAnimation { duration: 100 } }
                }
                KeyNavigation.tab: cancelButton
                KeyNavigation.backtab: identitySelector.visible ? identitySelector : authenticateButton
                Keys.onReturnPressed: card.submitResponse()
                Keys.onEnterPressed: card.submitResponse()
            }
        }

        Label {
            objectName: "feedback"
            Layout.fillWidth: true
            visible: text !== ""
            text: card.feedback || (card.flow && !card.responding ? "Waiting for authentication…" : "")
            textFormat: Text.PlainText
            wrapMode: Text.Wrap
            color: card.failure || (card.flow && card.flow.supplementaryIsError) ? card.theme.colors.error : card.theme.colors.foreground
            font.family: card.theme.fonts.ui
            font.pixelSize: 12
            Accessible.role: Accessible.AlertMessage
        }

        RowLayout {
            Layout.fillWidth: true
            spacing: 10
            Item { Layout.fillWidth: true }
            AuthButton {
                id: cancelButton
                objectName: "cancelButton"
                text: "Cancel"
                onClicked: card.cancel()
                onActiveFocusChanged: if (activeFocus) card.focusMoved(cancelButton)
                KeyNavigation.tab: authenticateButton.enabled ? authenticateButton : identitySelector.visible ? identitySelector : cancelButton
                KeyNavigation.backtab: input.enabled ? input : identitySelector.visible ? identitySelector : cancelButton
            }
            AuthButton {
                id: authenticateButton
                objectName: "authenticateButton"
                text: "Authenticate"
                primary: true
                enabled: card.responding
                onClicked: card.submitResponse()
                onActiveFocusChanged: if (activeFocus) card.focusMoved(authenticateButton)
                KeyNavigation.tab: identitySelector.visible ? identitySelector : input
                KeyNavigation.backtab: cancelButton
            }
        }

    }
}
