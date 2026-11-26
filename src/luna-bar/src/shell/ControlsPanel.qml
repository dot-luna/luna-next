pragma ComponentBehavior: Bound
// Quickshell exports these model/screen members at runtime, but omits them from qmltypes.
// qmllint disable missing-property
import QtQuick

BarPopup {
    id: panel
    required property var services
    required property var settings
    property string page: "home"
    side: "right"
    namespace: "luna-bar-controls"
    implicitWidth: 340
    implicitHeight: Math.min(body.implicitHeight + 32, screen ? screen.height - top - 16 : 700)
    onOpenChanged: {
        if (open) { page = "home"; services.refresh(); body.forceActiveFocus(); }
    }

    PanelScroll {
        id: scroll
        anchors.fill: parent
        anchors.margins: 16
        contentHeight: body.implicitHeight
        Loader {
            id: body
            width: scroll.width
            active: panel.open
            sourceComponent: panel.page === "home" ? home : panel.page === "wifi" ? wifi
                : panel.page === "bluetooth" ? bluetooth : audio
            onLoaded: { scroll.contentY = 0; forceActiveFocus(); arrival.restart(); }
            Keys.onEscapePressed: panel.open = false
            NumberAnimation { id: arrival; target: body; property: "opacity"; from: 0.5; to: 1; duration: 120 }
        }
    }
    Component {
        id: home
        ControlsHome {
            theme: panel.theme; settings: panel.settings; services: panel.services
            onNavigate: page => panel.page = page
            onDismissed: panel.open = false
        }
    }
    Component {
        id: wifi
        WifiPage { theme: panel.theme; services: panel.services; onBack: panel.page = "home" }
    }
    Component {
        id: bluetooth
        BluetoothPage {
            theme: panel.theme; services: panel.services
            onBack: panel.page = "home"
            onDismissed: panel.open = false
        }
    }
    Component {
        id: audio
        AudioPage {
            theme: panel.theme; audio: panel.services.audio; input: panel.page === "input"
            onBack: panel.page = "home"
        }
    }
}
