pragma ComponentBehavior: Bound

import QtQuick
import "." as Components

Rectangle {
    id: badge
    enum Variant { Primary, Secondary, Outline, Destructive }
    required property Components.Theme theme
    property string text: ""
    property int variant: Badge.Primary
    implicitWidth: label.implicitWidth + 16
    implicitHeight: label.implicitHeight + 8
    radius: theme.rounding
    color: variant === Badge.Primary ? theme.accent
        : variant === Badge.Destructive ? theme.error
        : variant === Badge.Secondary ? theme.surface : "transparent"
    border.width: variant === Badge.Outline ? Math.max(1, theme.borderWidth) : 0
    border.color: theme.line
    Accessible.role: Accessible.StaticText
    Accessible.name: text

    Components.Text {
        id: label
        anchors.centerIn: parent
        theme: badge.theme
        text: badge.text
        font.pixelSize: 11
        wrapMode: Text.NoWrap
        color: badge.variant === Badge.Primary ? badge.theme.accentText
            : badge.variant === Badge.Destructive ? badge.theme.surface : badge.theme.text
        Accessible.ignored: true
    }
}
