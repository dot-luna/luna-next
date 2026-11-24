pragma ComponentBehavior: Bound
import QtQuick
import Quickshell
import Quickshell.Wayland
import Quickshell.Hyprland

// The calendar and clocks, centred under the bar. Clicking outside or Escape closes it.
PanelWindow {
    id: popup
    required property var theme
    required property var barWindow
    /** Resolved clock settings, shared with the bar's clock. */
    required property var clock
    /** "ad" or "bs"; only the initial calendar, so the switch keeps its choice while running. */
    required property string initialMode
    required property int top
    property bool open: false
    property real reveal: open ? 1 : 0
    Behavior on reveal { NumberAnimation { duration: 160; easing.type: Easing.OutCubic } }

    onOpenChanged: if (open) {
        view.reset();
        view.forceActiveFocus();
    }

    visible: open || reveal > 0
    color: "transparent"
    // Ignore other exclusive zones so `top` is measured from the screen edge, below the bar.
    exclusionMode: ExclusionMode.Ignore
    anchors.top: true
    // qmllint disable missing-property
    margins.top: top
    // qmllint enable missing-property
    implicitWidth: row.implicitWidth
    implicitHeight: Math.max(view.implicitHeight, clocks.implicitHeight)
    mask: open ? null : noInput
    WlrLayershell.namespace: "luna-bar-calendar"
    WlrLayershell.layer: WlrLayer.Top
    WlrLayershell.keyboardFocus: open ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None

    Region { id: noInput }

    // Follow the theme's blur like the menu card, so content behind stays legible.
    BackgroundEffect.blurRegion: popup.theme.appearance.blur && popup.theme.appearance.blur.enabled ? card : null
    Region {
        id: card
        item: background
        radius: background.radius
    }

    // Clicks on the bar keep the grab, so the clock can toggle the calendar closed itself.
    HyprlandFocusGrab {
        active: popup.open
        windows: [popup, popup.barWindow]
        onCleared: popup.open = false
    }

    Rectangle {
        id: background
        anchors.fill: parent
        opacity: popup.reveal
        transform: Translate { y: (popup.reveal - 1) * 8 }
        color: Qt.alpha(popup.theme.colors.background, popup.theme.appearance.opacity.active)
        border.color: popup.theme.colors.muted
        border.width: popup.theme.appearance.border_width
        radius: popup.theme.appearance.rounding

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
}
