pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls.Basic as Controls
import "." as Components

Controls.Button {
    id: button

    enum Variant { Primary, Secondary, Outline, Ghost }
    required property Components.Theme theme
    property int variant: Button.Primary

    implicitWidth: Math.max(80, implicitContentWidth + leftPadding + rightPadding)
    implicitHeight: Math.max(36, implicitContentHeight + topPadding + bottomPadding)
    horizontalPadding: 14
    verticalPadding: 8
    font.family: theme.font
    font.pixelSize: 13
    hoverEnabled: true
    focusPolicy: Qt.StrongFocus
    opacity: enabled ? 1 : 0.45
    Accessible.role: Accessible.Button
    Accessible.name: text

    // Native click() also triggers Actions and checkable state, unlike emitting clicked().
    function activateFromKeyboard(event) {
        event.accepted = true;
        if (enabled && !event.isAutoRepeat)
            click();
    }
    Keys.onReturnPressed: event => activateFromKeyboard(event)
    Keys.onEnterPressed: event => activateFromKeyboard(event)

    contentItem: Components.Text {
        theme: button.theme
        text: button.text
        font: button.font
        color: button.variant === Button.Primary ? button.theme.accentText : button.theme.text
        horizontalAlignment: Text.AlignHCenter
        verticalAlignment: Text.AlignVCenter
        wrapMode: Text.NoWrap
        elide: Text.ElideRight
        Accessible.ignored: true
    }

    background: Rectangle {
        id: background

        radius: button.theme.rounding
        border.width: button.variant === Button.Outline ? Math.max(1, button.theme.borderWidth) : 0
        border.color: button.theme.line
        color: {
            const pressed = button.enabled && (button.down || button.checked);
            const hovered = button.enabled && button.hovered;
            if (button.variant === Button.Primary) {
                const amount = pressed ? 0.14 : hovered ? 0.07 : 0;
                const text = button.theme.accentText;
                return Qt.tint(button.theme.accent, Qt.rgba(text.r, text.g, text.b, amount));
            }
            if (button.variant === Button.Secondary) {
                const amount = pressed ? 0.1 : hovered ? 0.05 : 0;
                const text = button.theme.text;
                return Qt.tint(button.theme.raised, Qt.rgba(text.r, text.g, text.b, amount));
            }
            return pressed || hovered ? button.theme.raised : "transparent";
        }
        Behavior on color { ColorAnimation { duration: 90 } }

        Rectangle {
            anchors.fill: parent
            anchors.margins: -3
            radius: background.radius === 0 ? 0 : background.radius + 3
            color: "transparent"
            border.color: button.theme.accent
            border.width: 2
            visible: button.enabled && button.visualFocus
        }
    }
}
