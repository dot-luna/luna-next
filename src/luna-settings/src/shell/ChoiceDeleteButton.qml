pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls.Basic

Button {
    id: button
    required property SettingsTheme theme
    required property bool applied
    required property bool cardHovered
    required property bool cardFocused
    z: 2
    width: 28
    height: 28
    padding: 6
    visible: !applied
    // Keep the action in the tab order; keyboard focus reveals it like pointer hover.
    opacity: cardHovered || cardFocused || hovered || visualFocus ? 1 : 0
    hoverEnabled: true
    Accessible.name: text
    ToolTip.visible: opacity > 0 && (hovered || visualFocus)
    ToolTip.text: text
    ToolTip.delay: 400
    Keys.onReturnPressed: clicked()
    Keys.onEnterPressed: clicked()
    background: Rectangle {
        color: button.hovered ? button.theme.raised : button.theme.surface
        radius: button.theme.rounding
        border.width: button.visualFocus ? 1 : 0
        border.color: button.theme.accent
    }
    contentItem: SettingsIcon { name: "delete-02"; ink: button.theme.text }
}
