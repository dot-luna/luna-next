import QtQuick
import "Settings.js" as Settings

// The builder supplies a complete settings snapshot and local assets. The greeter
// never reads the user's configuration or invokes the Luna CLI.
Item {
    id: root

    property var settings: Settings.values
    // SDDM supplies these context properties; test hosts inject explicit models.
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
    }

    Loader {
        id: screenLoader
        objectName: "screenLoader"
        anchors.fill: parent
        focus: true
        Component.onCompleted: setSource(Qt.resolvedUrl("screen/Screen.qml"), {
            settings: root.settings,
            login: controller
        })
    }

    Text {
        anchors.centerIn: parent
        visible: screenLoader.status === Loader.Error
        text: qsTr("The login screen could not be loaded.")
        color: root.settings.colors.error
        font.family: root.settings.fonts.ui
        textFormat: Text.PlainText
    }
}
