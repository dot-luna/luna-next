pragma ComponentBehavior: Bound
import QtQuick
import Quickshell
import Quickshell.Wayland
import Quickshell.Hyprland
import "Workspaces.js" as Workspaces

PanelWindow {
    id: bar
    required property var theme
    required property var settings
    required property bool shown
    readonly property var monitor: Hyprland.monitorFor(screen)
    readonly property int activeWorkspace: monitor && monitor.activeWorkspace ? monitor.activeWorkspace.id : 0
    readonly property int gap: theme.appearance.gaps.outer
    readonly property bool fullscreen: monitor && monitor.activeWorkspace ? monitor.activeWorkspace.hasFullscreen : false
    // Hidden by the toggle or while this monitor shows a fullscreen window.
    readonly property bool presented: shown && !fullscreen
    property bool keyboardActive: false
    // Animated separately from `presented`, so hiding releases space and input immediately.
    property real reveal: presented ? 1 : 0
    Behavior on reveal { NumberAnimation { duration: 200; easing.type: Easing.OutCubic } }

    // A hidden bar (toggled off or under a fullscreen window) never takes the keyboard.
    function beginFocus() {
        if (!presented) return;
        calendar.open = false;
        keyboardActive = true;
        strip.focusActive();
    }
    function release() { keyboardActive = false; }

    onPresentedChanged: if (!presented) {
        release();
        calendar.open = false;
    }

    visible: presented || reveal > 0
    anchors { top: true; left: true; right: true }
    // qmllint disable missing-property
    margins { top: bar.gap; left: bar.gap; right: bar.gap }
    // qmllint enable missing-property
    implicitHeight: 32
    color: "transparent"
    exclusiveZone: presented ? implicitHeight : 0
    mask: presented ? null : noInput
    WlrLayershell.namespace: "luna-bar"
    WlrLayershell.layer: WlrLayer.Top
    // Only an explicit focus action takes the keyboard from the current application.
    WlrLayershell.keyboardFocus: keyboardActive ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None
    onActiveWorkspaceChanged: release()

    Region { id: noInput }

    Item {
        id: content
        anchors.fill: parent
        opacity: bar.reveal
        transform: Translate { y: (bar.reveal - 1) * 10 }

        Rectangle {
            anchors.fill: parent
            color: Qt.alpha(bar.theme.colors.background, bar.theme.appearance.opacity.active)
            border.color: bar.theme.colors.muted
            border.width: bar.theme.appearance.border_width
            radius: Math.min(bar.theme.appearance.rounding, height / 2)
        }
        WorkspaceStrip {
            id: strip
            anchors.left: parent.left
            anchors.leftMargin: 8
            anchors.verticalCenter: parent.verticalCenter
            theme: bar.theme
            activeWorkspace: bar.activeWorkspace
            workspaceIds: Workspaces.ids(Hyprland.workspaces.values, activeWorkspace)
            icons: bar.settings.workspaces.icons
            visibleCount: bar.settings.workspaces.visible
            onDismissed: bar.release()
            onLeaving: clock.forceActiveFocus(Qt.TabFocusReason)
            onActivated: workspace => {
                bar.release();
                calendar.open = false;
                Hyprland.dispatch("hl.dsp.focus({workspace=" + workspace + "})");
            }
        }
        Clock {
            id: clock
            anchors.centerIn: parent
            theme: bar.theme
            format: bar.settings.clock.format
            open: calendar.open
            Keys.onEscapePressed: bar.release()
            onLeaving: strip.focusActive()
            onClicked: {
                bar.release();
                calendar.open = !calendar.open;
            }
        }
    }

    Calendar {
        id: calendar
        screen: bar.screen
        theme: bar.theme
        barWindow: bar
        clock: bar.settings.clock
        initialMode: bar.settings.calendar.default
        top: bar.gap + bar.implicitHeight + bar.gap
    }
}
