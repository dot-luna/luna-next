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
    required property var controlsState
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
        controls.open = false;
        tray.open = false;
        keyboardActive = true;
        strip.focusActive();
    }
    function release() { keyboardActive = false; }

    onPresentedChanged: if (!presented) {
        release();
        calendar.open = false;
        controls.open = false;
        tray.open = false;
    }

    // Stay mapped while hidden: Hyprland recalculates reserved space a step late when a layer
    // maps or unmaps, which left windows below a hidden bar. Hidden, it is transparent,
    // reserves nothing and passes input through.
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
                controls.open = false;
                tray.open = false;
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
            onLeaving: direction => {
                if (direction < 0) strip.focusActive();
                else status.forceActiveFocus(Qt.TabFocusReason);
            }
            onClicked: {
                bar.release();
                controls.open = false;
                tray.open = false;
                calendar.open = !calendar.open;
            }
        }
        Row {
            anchors.right: parent.right
            anchors.rightMargin: 8
            anchors.verticalCenter: parent.verticalCenter
            spacing: 4
            IconButton {
                theme: bar.theme
                iconName: "arrow-down-01"
                size: 26
                visible: bar.settings.tray.enabled
                active: tray.open
                Accessible.name: "Tray apps"
                Keys.onEscapePressed: bar.release()
                onClicked: {
                    bar.release();
                    calendar.open = false;
                    controls.open = false;
                    tray.open = !tray.open;
                }
            }
            StatusButton {
                id: status
                theme: bar.theme
                services: bar.controlsState
                open: controls.open
                Keys.onEscapePressed: bar.release()
                onClicked: {
                    bar.release();
                    calendar.open = false;
                    tray.open = false;
                    controls.open = !controls.open;
                }
            }
        }
    }

    ControlsPanel {
        id: controls
        screen: bar.screen
        theme: bar.theme
        barWindow: bar
        services: bar.controlsState
        settings: bar.settings.controls
        top: bar.gap + bar.implicitHeight + bar.gap
    }
    TrayPopup {
        id: tray
        screen: bar.screen
        theme: bar.theme
        barWindow: bar
        top: bar.gap + bar.implicitHeight + bar.gap
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
