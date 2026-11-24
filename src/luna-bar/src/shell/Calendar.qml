pragma ComponentBehavior: Bound
import QtQuick

// The calendar and clocks, centred under the bar.
BarPopup {
    id: popup
    /** Resolved clock settings, shared with the bar's clock. */
    required property var clock
    /** "ad" or "bs"; only the initial calendar, so the switch keeps its choice while running. */
    required property string initialMode

    namespace: "luna-bar-calendar"
    implicitWidth: row.implicitWidth
    implicitHeight: Math.max(view.implicitHeight, clocks.implicitHeight)
    onOpenChanged: if (open) {
        view.reset();
        view.forceActiveFocus();
    }

    Row {
        id: row
        height: parent.height
        CalendarView {
            id: view
            width: implicitWidth
            height: parent.height
            theme: popup.theme
            Component.onCompleted: mode = popup.initialMode
            onDismissed: popup.open = false
        }
        Rectangle {
            width: popup.theme.appearance.border_width || 1
            height: parent.height - 28
            anchors.verticalCenter: parent.verticalCenter
            color: popup.theme.colors.muted
        }
        ClockPanel {
            id: clocks
            width: implicitWidth
            height: parent.height
            theme: popup.theme
            clock: popup.clock
            active: popup.open
        }
    }
}
