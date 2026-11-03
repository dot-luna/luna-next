pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Wayland

Scope {
    id: awake
    property bool enabled: false

    // Inhibitors need mapped surfaces even while the menu is hidden. Keep one
    // input-transparent surface per output, owned and released with this shell.
    Variants {
        id: surfaces
        model: Quickshell.screens
        delegate: PanelWindow {
            id: surface
            required property var modelData
            objectName: "stayAwakeSurface"
            screen: modelData
            visible: awake.enabled
            implicitWidth: 1
            implicitHeight: 1
            color: "transparent"
            mask: Region {}
            anchors { top: true; left: true }
            exclusionMode: ExclusionMode.Ignore
            WlrLayershell.layer: WlrLayer.Overlay
            WlrLayershell.namespace: "luna-stay-awake"
            WlrLayershell.keyboardFocus: WlrKeyboardFocus.None

            IdleInhibitor {
                id: inhibitor
                objectName: "stayAwakeInhibitor"
                window: surface
                enabled: awake.enabled
            }
        }
    }
}
