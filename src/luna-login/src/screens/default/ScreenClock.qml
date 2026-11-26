pragma ComponentBehavior: Bound
import QtQuick

Column {
    id: clock
    required property var theme
    property bool compact: false
    property date now: new Date()
    spacing: 2

    Timer {
        interval: 1000
        running: clock.visible
        repeat: true
        onTriggered: clock.now = new Date()
    }
    Text {
        objectName: "clockTime"
        anchors.horizontalCenter: parent.horizontalCenter
        text: Qt.formatTime(clock.now, "hh:mm")
        color: clock.theme.colors.bright_foreground
        font.family: clock.theme.fonts.ui
        font.pixelSize: clock.compact ? 64 : 88
        font.weight: Font.Medium
        font.letterSpacing: -3
    }
    Text {
        objectName: "clockDate"
        anchors.horizontalCenter: parent.horizontalCenter
        text: Qt.formatDate(clock.now, "dddd, d MMMM")
        color: clock.theme.colors.foreground
        font.family: clock.theme.fonts.ui
        font.pixelSize: 15
        opacity: 0.85
    }
}
