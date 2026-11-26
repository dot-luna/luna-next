pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls.Basic

Button {
    id: button
    required property SettingsTheme theme
    property bool primary: false

    implicitHeight: 34
    leftPadding: flat ? 0 : 13
    rightPadding: flat ? 0 : 13
    topPadding: 8
    bottomPadding: 8
    font.family: theme.font
    font.pixelSize: 12
    hoverEnabled: true
    Keys.onReturnPressed: clicked()
    Keys.onEnterPressed: clicked()

    contentItem: Text {
        text: button.text
        font: button.font
        color: button.primary ? button.theme.accentText : button.flat ? button.theme.subtle : button.theme.text
        verticalAlignment: Text.AlignVCenter
        horizontalAlignment: Text.AlignHCenter
        textFormat: Text.PlainText
    }
    background: Rectangle {
        radius: button.theme.rounding
        color: button.primary ? button.theme.accent : button.hovered || button.down ? button.theme.raised : "transparent"
        border.width: button.visualFocus ? Math.max(1, button.theme.borderWidth) : !button.flat && !button.primary ? button.theme.borderWidth : 0
        border.color: button.visualFocus ? button.theme.accent : button.theme.line
        Behavior on color { ColorAnimation { duration: 90 } }
    }
}
