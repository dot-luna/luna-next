pragma ComponentBehavior: Bound
import QtQuick
import Quickshell
import Quickshell.Wayland
import Quickshell.Hyprland
import "Workspaces.js" as Workspaces

PanelWindow {
    id: bar
    required property var theme
    readonly property var monitor: Hyprland.monitorFor(screen)
    readonly property int activeWorkspace: monitor && monitor.activeWorkspace ? monitor.activeWorkspace.id : 0
    property bool keyboardActive: false

    function beginFocus() {
        keyboardActive = true;
        strip.focusActive();
    }
    function release() { keyboardActive = false; }

    anchors { top: true; left: true; right: true }
    // qmllint disable missing-property
    margins { top: theme.appearance.gaps.outer; left: theme.appearance.gaps.outer; right: theme.appearance.gaps.outer }
    // qmllint enable missing-property
    implicitHeight: 32
    color: "transparent"
    exclusiveZone: implicitHeight
    WlrLayershell.namespace: "luna-bar"
    WlrLayershell.layer: WlrLayer.Top
    // Only an explicit focus action takes the keyboard from the current application.
    WlrLayershell.keyboardFocus: keyboardActive ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None
    onActiveWorkspaceChanged: release()

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
        onDismissed: bar.release()
        onActivated: workspace => {
            bar.release();
            Hyprland.dispatch("hl.dsp.focus({workspace=" + workspace + "})");
        }
    }
}
