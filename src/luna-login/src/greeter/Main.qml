import QtQuick
import "Settings.js" as Settings

Item {
    id: root

    // Resolve bundle-relative assets here so screens receive usable file URLs.
    readonly property var settings: ({
        screen: { path: Qt.resolvedUrl(Settings.values.screen.path + "/").toString() },
        theme: Settings.values.theme,
        background: { path: Settings.values.background.path ? Qt.resolvedUrl(Settings.values.background.path).toString() : "" },
        actions: Settings.values.actions,
        login: Settings.values.login
    })
    // SDDM injects these models and the proxy; isolated hosts can supply fakes.
    // qmllint disable unqualified
    property var backend: typeof sddm !== "undefined" ? sddm : null
    property var usersModel: typeof userModel !== "undefined" ? userModel : null
    property var sessionsModel: typeof sessionModel !== "undefined" ? sessionModel : null
    property var keyboardState: typeof keyboard !== "undefined" ? keyboard : null
    // qmllint enable unqualified
    readonly property alias login: controller
    readonly property alias screenItem: screenLoader.item

    width: 1280
    height: 720

    LoginController {
        id: controller
        backend: root.backend
        users: root.usersModel
        sessions: root.sessionsModel
        keyboardState: root.keyboardState
        preferredUser: root.settings.login.user
    }

    Loader {
        id: screenLoader
        objectName: "screenLoader"
        anchors.fill: parent
        focus: true
        Component.onCompleted: setSource(root.settings.screen.path + "Screen.qml", {
            settings: root.settings,
            login: controller
        })
    }

    Text {
        anchors.centerIn: parent
        visible: screenLoader.status === Loader.Error
        text: qsTr("The login screen could not be loaded. Press %1 for console login.").arg(controller.consoleShortcut)
        width: Math.min(440, parent.width - 48)
        wrapMode: Text.Wrap
        color: root.settings.theme.colors.error
        font.family: root.settings.theme.fonts.ui
        textFormat: Text.PlainText
    }
}
