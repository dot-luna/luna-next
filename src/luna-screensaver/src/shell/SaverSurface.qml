pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Wayland

PanelWindow {
    id: surface

    required property var theme
    required property date dateTime
    property bool showing: false
    property bool keyboardActive: false
    property bool movementReady: false
    signal dismissed()

    visible: showing
    color: theme.colors.background
    anchors { top: true; bottom: true; left: true; right: true }
    exclusionMode: ExclusionMode.Ignore
    WlrLayershell.namespace: "luna-screensaver"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: visible && keyboardActive ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None

    onVisibleChanged: {
        movementReady = false;
        movementDelay.stop();
        if (visible) {
            movementDelay.start();
            if (keyboardActive)
                input.forceActiveFocus();
        }
    }

    // Ignore the synthetic pointer move when the new surface appears. Keyboard,
    // clicks, and wheel input remain available from the first visible frame.
    Timer {
        id: movementDelay
        interval: 300
        onTriggered: surface.movementReady = true
    }

    Item {
        id: input
        objectName: "screensaver-input"
        anchors.fill: parent
        focus: true
        Keys.onPressed: event => {
            event.accepted = true;
            surface.dismissed();
        }

        ClockView {
            anchors.centerIn: parent
            theme: surface.theme
            dateTime: surface.dateTime
            availableWidth: surface.width
            drifting: surface.showing
        }

        MouseArea {
            objectName: "screensaver-pointer"
            anchors.fill: parent
            acceptedButtons: Qt.AllButtons
            hoverEnabled: true
            cursorShape: Qt.BlankCursor
            onPressed: surface.dismissed()
            onWheel: surface.dismissed()
            onPositionChanged: if (surface.movementReady)
                surface.dismissed()
        }
    }
}
