pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic

Button {
    id: button
    required property var theme
    required property var services
    property bool open: false
    implicitHeight: 26
    implicitWidth: status.implicitWidth + 12
    padding: 6
    focusPolicy: Qt.StrongFocus
    Accessible.name: "Quick controls"
    Accessible.description: services.networkName + (services.hasBattery ? ", battery " + services.batteryPercent + "%" : "")
    Keys.onReturnPressed: click()
    Keys.onEnterPressed: click()
    HoverHandler { cursorShape: Qt.PointingHandCursor }
    background: Rectangle {
        color: "transparent"
        radius: Math.min(button.theme.appearance.rounding, height / 2)
        border.width: button.open || button.visualFocus ? 1 : 0
        border.color: button.theme.colors.accent
    }
    contentItem: Row {
        id: status
        spacing: 8
        opacity: button.hovered || button.open ? 1 : 0.85
        Icon { width: 16; height: 16; name: button.services.networkIcon; ink: button.theme.colors.foreground }
        Icon { width: 16; height: 16; name: button.services.audio.outputIcon; ink: button.theme.colors.foreground }
        Icon {
            width: 16; height: 16; visible: button.services.hasBattery
            name: button.services.batteryIcon; ink: button.theme.colors.foreground
        }
        PanelText { theme: button.theme; visible: button.services.hasBattery; text: button.services.batteryPercent + "%" }
    }
}
