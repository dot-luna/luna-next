pragma ComponentBehavior: Bound
import QtQuick
import "."
import QtQuick.Controls.Basic

Button {
    id: button
    required property var theme
    required property string iconName

    implicitWidth: 54
    implicitHeight: 54
    padding: 14
    font.family: theme.fonts.ui
    font.pixelSize: 12
    hoverEnabled: true
    Accessible.name: text
    ToolTip.visible: hovered || visualFocus
    ToolTip.text: text
    ToolTip.delay: hovered ? 450 : 0

    contentItem: ScreenIcon {
        name: button.iconName
        ink: button.theme.colors.foreground
        opacity: !button.enabled ? 0.4 : button.down ? 0.65 : 1
        Behavior on opacity {
            NumberAnimation {
                duration: 90
            }
        }
    }
    background: Rectangle {
        radius: button.theme.appearance.rounding
        color: button.down ? button.theme.colors.selection : button.hovered || button.visualFocus ? Qt.alpha(button.theme.colors.selection, 0.8) : "transparent"
        border.width: button.visualFocus ? 1 : 0
        border.color: button.theme.colors.accent
        Behavior on color {
            ColorAnimation {
                duration: 140
            }
        }
    }
}
