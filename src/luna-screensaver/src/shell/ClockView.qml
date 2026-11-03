pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Layouts

ColumnLayout {
    id: clock

    required property var theme
    required property date dateTime
    property real availableWidth: 800
    property bool drifting: false

    spacing: 14
    transform: Translate { id: drift }

    SequentialAnimation {
        running: clock.drifting
        loops: Animation.Infinite
        NumberAnimation { target: drift; property: "x"; from: -35; to: 35; duration: 45000; easing.type: Easing.InOutSine }
        NumberAnimation { target: drift; property: "x"; from: 35; to: -35; duration: 45000; easing.type: Easing.InOutSine }
    }
    SequentialAnimation {
        running: clock.drifting
        loops: Animation.Infinite
        NumberAnimation { target: drift; property: "y"; from: -20; to: 20; duration: 60000; easing.type: Easing.InOutSine }
        NumberAnimation { target: drift; property: "y"; from: 20; to: -20; duration: 60000; easing.type: Easing.InOutSine }
    }

    Text {
        objectName: "screensaver-brand"
        Layout.alignment: Qt.AlignHCenter
        text: "Luna"
        color: clock.theme.colors.accent
        font.family: clock.theme.fonts.ui
        font.pixelSize: 20
        font.letterSpacing: 5
    }

    Text {
        objectName: "screensaver-clock"
        Layout.alignment: Qt.AlignHCenter
        text: Qt.formatTime(clock.dateTime, Qt.locale().timeFormat(Locale.ShortFormat))
        color: clock.theme.colors.bright_foreground
        font.family: clock.theme.fonts.ui
        font.pixelSize: Math.min(96, clock.availableWidth / 8)
        font.weight: Font.Light
    }

    Text {
        objectName: "screensaver-date"
        Layout.alignment: Qt.AlignHCenter
        text: Qt.formatDate(clock.dateTime, "dddd, d MMMM")
        color: clock.theme.colors.foreground
        font.family: clock.theme.fonts.ui
        font.pixelSize: 20
    }
}
