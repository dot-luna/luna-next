pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Effects
import ".." as Luna

// Layout, background effects, and the welcome stage belong to this screen;
// replacing the screen does not change the shared SDDM controller.
Item {
    id: screen
    required property var settings
    required property var login
    property bool loginVisible: false
    property date now: new Date()
    focus: true

    function revealLogin() {
        loginVisible = true;
        Qt.callLater(form.focusInput);
    }

    function showWelcome() {
        if (login.busy)
            return;
        form.clearPassword();
        login.clearError();
        loginVisible = false;
        forceActiveFocus(Qt.OtherFocusReason);
    }

    Keys.onPressed: event => {
        if (event.key === Qt.Key_Escape) {
            showWelcome();
            event.accepted = true;
        } else if (!loginVisible) {
            // The opening keystroke reveals the form without entering a hidden
            // password or accidentally starting authentication.
            revealLogin();
            event.accepted = true;
        } else {
            event.accepted = false;
        }
    }

    Luna.Background {
        id: wallpaper
        objectName: "screenBackground"
        anchors.fill: parent
        wallpaper: screen.settings.wallpaper
        layer.enabled: screen.settings.appearance.blur.enabled
        layer.effect: MultiEffect {
            objectName: "backgroundBlur"
            blurEnabled: true
            blur: 1
            blurMax: Math.max(2, Math.min(64, screen.settings.appearance.blur.size))
            // Scale Qt's blur radius from the theme's configured pass count.
            blurMultiplier: Math.max(0, screen.settings.appearance.blur.passes - 1)
            autoPaddingEnabled: false
        }
    }

    Rectangle {
        objectName: "backgroundShade"
        anchors.fill: parent
        color: screen.settings.colors.darker_background
        opacity: 1 - (screen.loginVisible
            ? screen.settings.appearance.opacity.inactive : screen.settings.appearance.opacity.active)
        Behavior on opacity {
            NumberAnimation {
                duration: 180
            }
        }
    }

    Timer {
        interval: 1000
        running: true
        repeat: true
        onTriggered: screen.now = new Date()
    }

    Column {
        anchors {
            top: parent.top
            horizontalCenter: parent.horizontalCenter
            topMargin: Math.max(48, parent.height * 0.12)
        }
        spacing: 4
        opacity: screen.loginVisible ? 0 : 1
        visible: opacity > 0
        Behavior on opacity {
            NumberAnimation {
                duration: 180
            }
        }
        Text {
            objectName: "clockText"
            anchors.horizontalCenter: parent.horizontalCenter
            text: Qt.formatDateTime(screen.now, "hh:mm")
            color: screen.settings.colors.bright_foreground
            font.family: screen.settings.fonts.ui
            font.pixelSize: Math.min(76, Math.max(42, screen.height * 0.08))
            font.weight: Font.Light
        }
        Text {
            objectName: "dateText"
            anchors.horizontalCenter: parent.horizontalCenter
            text: Qt.formatDate(screen.now, "dddd, MMMM d")
            color: screen.settings.colors.foreground
            font.family: screen.settings.fonts.ui
            font.pixelSize: 16
        }
    }

    LoginForm {
        id: form
        objectName: "loginForm"
        anchors.centerIn: parent
        width: Math.min(300, parent.width - 48)
        settings: screen.settings
        login: screen.login
        opacity: screen.loginVisible ? 1 : 0
        visible: opacity > 0
        enabled: screen.loginVisible
        Behavior on opacity {
            NumberAnimation {
                duration: 180
            }
        }
    }

    Text {
        objectName: "welcomePrompt"
        anchors {
            horizontalCenter: parent.horizontalCenter
            bottom: parent.bottom
            bottomMargin: 104
        }
        visible: !screen.loginVisible
        text: qsTr("Press any key to sign in")
        color: screen.settings.colors.foreground
        font.family: screen.settings.fonts.ui
        font.pixelSize: 13
    }

    LoginFooter {
        anchors {
            left: parent.left
            right: parent.right
            bottom: parent.bottom
            margins: 28
        }
        settings: screen.settings
        login: screen.login
    }
}
