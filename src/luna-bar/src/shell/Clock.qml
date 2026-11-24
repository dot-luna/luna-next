pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic
import Quickshell

// Date and time in the configured Qt format; activating it toggles the calendar.
Button {
    id: clock
    required property var theme
    required property string format
    property bool open: false
    signal leaving(int direction)

    objectName: "clock"
    focusPolicy: Qt.StrongFocus
    padding: 0
    leftPadding: 8
    rightPadding: 8
    implicitHeight: 26
    Accessible.name: label.text
    Accessible.role: Accessible.Button
    Accessible.description: open ? "Close calendar" : "Open calendar"
    Keys.onReturnPressed: click()
    Keys.onEnterPressed: click()
    Keys.onTabPressed: event => leaving(event.modifiers & Qt.ShiftModifier ? -1 : 1)
    Keys.onBacktabPressed: leaving(-1)

    SystemClock {
        id: time
        // Ignore quoted literals so text such as 'Week' does not force second updates.
        precision: clock.format.replace(/'[^']*'/g, "").includes("s") ? SystemClock.Seconds : SystemClock.Minutes
    }

    HoverHandler { cursorShape: Qt.PointingHandCursor }

    background: Rectangle {
        color: "transparent"
        radius: Math.min(clock.theme.appearance.rounding, height / 2)
        border.width: clock.visualFocus ? 1 : 0
        border.color: clock.theme.colors.accent
    }
    contentItem: Text {
        id: label
        text: Qt.formatDateTime(time.date, clock.format)
        color: clock.theme.colors.foreground
        opacity: clock.hovered || clock.open ? 1 : 0.9
        font.family: clock.theme.fonts.ui
        font.pixelSize: 12
        Behavior on opacity { NumberAnimation { duration: 100 } }
        horizontalAlignment: Text.AlignHCenter
        verticalAlignment: Text.AlignVCenter
    }
}
