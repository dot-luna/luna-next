pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic

Item {
    id: screen
    required property var settings
    required property var login
    property bool appeared: false
    readonly property bool compact: height < 700
    readonly property bool resting: !form.passwordVisible && !shutdown.active
    focus: true
    opacity: appeared && !login.authenticated ? 1 : 0
    enabled: !login.authenticated

    // SDDM owns session startup; fading never postpones authentication or handoff.
    Behavior on opacity {
        NumberAnimation {
            duration: 240
            easing.type: Easing.InOutQuad
        }
    }

    function focusInput() {
        if (form.passwordVisible)
            form.revealPassword("");
        else
            forceActiveFocus(Qt.OtherFocusReason);
    }

    Keys.onPressed: event => {
        if (event.key === Qt.Key_Escape) {
            if (shutdown.active)
                shutdown.cancel();
            else
                form.dismiss();
            event.accepted = true;
        } else if (shutdown.active) {
            event.accepted = event.key !== Qt.Key_Tab && event.key !== Qt.Key_Backtab;
        } else if (!form.passwordVisible && !screen.login.busy) {
            if (event.key === Qt.Key_Left || event.key === Qt.Key_Right) {
                form.moveUser(event.key === Qt.Key_Left ? -1 : 1);
                event.accepted = true;
            } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
                form.revealPassword("");
                event.accepted = true;
            } else if (event.text && !(event.modifiers & (Qt.ControlModifier | Qt.AltModifier | Qt.MetaModifier)) && event.text.charCodeAt(0) >= 32) {
                form.revealPassword(event.text);
                event.accepted = true;
            }
        }
    }

    ScreenBackground {
        anchors.fill: parent
        settings: screen.settings
    }

    ScreenClock {
        id: clock
        objectName: "screenClock"
        opacity: screen.resting ? 1 : 0
        visible: screen.resting || opacity > 0
        enabled: screen.resting
        Behavior on opacity {
            NumberAnimation {
                duration: 160
                easing.type: Easing.OutQuad
            }
        }
        anchors.horizontalCenter: parent.horizontalCenter
        y: Math.max(28, Math.round(screen.height * 0.08))
        theme: screen.settings.theme
        compact: screen.compact
    }

    LoginForm {
        id: form
        objectName: "loginForm"
        anchors.horizontalCenter: parent.horizontalCenter
        y: Math.round((screen.height - implicitHeight) / 2)
        width: Math.min(320, screen.width - 48)
        opacity: shutdown.active ? 0 : 1
        visible: !shutdown.active || opacity > 0
        enabled: !shutdown.active
        Behavior on opacity {
            NumberAnimation {
                duration: 160
                easing.type: Easing.OutQuad
            }
        }
        settings: screen.settings
        login: screen.login
        compact: screen.compact
        onRestRequested: screen.forceActiveFocus(Qt.OtherFocusReason)
    }

    LoginFooter {
        objectName: "loginActions"
        opacity: screen.resting ? 1 : 0
        visible: screen.resting || opacity > 0
        enabled: screen.resting
        Behavior on opacity {
            NumberAnimation {
                duration: 160
                easing.type: Easing.OutQuad
            }
        }
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottom: parent.bottom
        anchors.bottomMargin: Math.max(28, Math.round(screen.height * 0.05))
        settings: screen.settings
        login: screen.login
        onActionRequested: action => {
            if (action === "powerOff") {
                form.dismiss();
                if (shutdown.start())
                    screen.forceActiveFocus(Qt.OtherFocusReason);
            } else {
                screen.login.requestAction(action);
            }
        }
    }

    ComboBox {
        id: layoutSelector
        objectName: "layoutSelector"
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.rightMargin: 32
        anchors.bottomMargin: 32
        implicitWidth: 90
        implicitHeight: 36
        opacity: screen.resting && count > 1 ? 1 : 0
        visible: (screen.resting && count > 1) || opacity > 0
        enabled: screen.resting && !screen.login.busy
        Behavior on opacity {
            NumberAnimation {
                duration: 160
                easing.type: Easing.OutQuad
            }
        }
        model: screen.login.keyboardLayouts
        textRole: "shortName"
        currentIndex: screen.login.currentLayout
        Accessible.name: qsTr("Keyboard layout")
        font.family: screen.settings.theme.fonts.ui
        font.pixelSize: 12
        palette.text: screen.settings.theme.colors.foreground
        palette.buttonText: screen.settings.theme.colors.foreground
        palette.window: screen.settings.theme.colors.background
        palette.base: screen.settings.theme.colors.background
        palette.highlight: screen.settings.theme.colors.selection
        palette.highlightedText: screen.settings.theme.colors.selection_foreground
        onActivated: screen.login.selectLayout(currentIndex)
        background: Rectangle {
            radius: screen.settings.theme.appearance.rounding
            color: layoutSelector.hovered || layoutSelector.visualFocus ? Qt.alpha(screen.settings.theme.colors.selection, 0.6) : "transparent"
            border.width: layoutSelector.visualFocus ? 1 : 0
            border.color: screen.settings.theme.colors.accent
            Behavior on color {
                ColorAnimation {
                    duration: 120
                }
            }
        }
    }

    ShutdownView {
        id: shutdown
        objectName: "shutdownView"
        anchors.fill: parent
        theme: screen.settings.theme
        login: screen.login
        delaySeconds: screen.settings.actions.shutdown_delay
        onCancelled: screen.forceActiveFocus(Qt.OtherFocusReason)
    }

    Component.onCompleted: {
        appeared = true;
        forceActiveFocus(Qt.OtherFocusReason);
    }
}
