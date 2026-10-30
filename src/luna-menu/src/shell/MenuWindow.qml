pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
// Registers structured ProcessContext conversion for execDetached(context).
import Quickshell.Io
import Quickshell.Wayland
import "Applications.js" as Applications

PanelWindow {
    id: panel

    required property var theme
    property bool opened: false
    readonly property alias content: menuContent
    signal dismissed()

    visible: opened
    color: "transparent"
    anchors { top: true; bottom: true; left: true; right: true }
    exclusionMode: ExclusionMode.Ignore
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.namespace: "luna-next-menu"
    WlrLayershell.keyboardFocus: visible ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None

    function show() {
        menuContent.reset();
        opened = true;
        focusDelay.restart();
    }

    function hide() {
        opened = false;
        focusDelay.stop();
    }

    onDismissed: hide()

    Timer {
        id: focusDelay
        interval: 40
        onTriggered: if (panel.opened) menuContent.focusSearch()
    }

    MouseArea {
        objectName: "dismissArea"
        anchors.fill: parent
        acceptedButtons: Qt.AllButtons
        onPressed: panel.dismissed()
    }

    MenuContent {
        id: menuContent
        objectName: "menuContent"
        anchors.centerIn: parent
        width: Math.max(0, Math.min(implicitWidth, panel.width - 32))
        height: Math.max(0, Math.min(implicitHeight, panel.height - 32))
        theme: panel.theme
        applications: DesktopEntries.applications.values
        onDismissed: panel.dismissed()
        onApplicationActivated: entry => {
            if (Applications.launch(entry, context => Quickshell.execDetached(context)))
                panel.dismissed();
        }
    }

    // A separate surface also dismisses clicks on an empty desktop on another output.
    Variants {
        model: Quickshell.screens
        delegate: PanelWindow {
            required property var modelData
            screen: modelData
            visible: panel.opened && modelData !== panel.screen
            color: "transparent"
            anchors { top: true; bottom: true; left: true; right: true }
            exclusionMode: ExclusionMode.Ignore
            WlrLayershell.layer: WlrLayer.Overlay
            WlrLayershell.namespace: "luna-next-menu-dismiss"
            WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
            MouseArea {
                anchors.fill: parent
                acceptedButtons: Qt.AllButtons
                onPressed: panel.dismissed()
            }
        }
    }
}
