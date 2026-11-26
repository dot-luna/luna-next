pragma ComponentBehavior: Bound

import QtQuick
import Luna.UI 1.0 as UI

UI.Button {
    variant: UI.Button.Ghost
    id: button
    required property bool applied
    required property bool cardHovered
    required property bool cardFocused
    z: 2
    width: 28
    height: 28
    padding: 6
    horizontalPadding: 6
    verticalPadding: 6
    visible: !applied
    // Keep the action in the tab order; keyboard focus reveals it like pointer hover.
    opacity: cardHovered || cardFocused || hovered || visualFocus ? 1 : 0
    hoverEnabled: true
    Accessible.name: text
    background: Rectangle {
        color: "transparent"
        radius: button.theme.rounding
        border.width: button.visualFocus ? 1 : 0
        border.color: button.theme.accent
    }
    contentItem: SettingsIcon { name: "delete-02"; ink: button.theme.error }
}
