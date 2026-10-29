pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic
import Quickshell
import Quickshell.Wayland

PanelWindow {
    id: panel

    required property var theme
    property var flow: null
    visible: flow !== null && !flow.isCompleted
    color: "transparent"
    anchors { top: true; bottom: true; left: true; right: true }
    exclusionMode: ExclusionMode.Ignore
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.namespace: "luna-next-polkit"
    WlrLayershell.keyboardFocus: visible ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None
    onVisibleChanged: if (visible) Qt.callLater(card.focusInput)

    Rectangle { anchors.fill: parent; color: "#80000000" }
    MouseArea { anchors.fill: parent; acceptedButtons: Qt.AllButtons }

    // Short displays and large system prompts remain scrollable without clipping actions.
    ScrollView {
        id: scroll
        anchors.centerIn: parent
        width: Math.max(0, Math.min(card.implicitWidth, panel.width - 32))
        height: Math.max(0, Math.min(card.implicitHeight, panel.height - 32))
        contentWidth: availableWidth
        clip: true
        ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
        AuthContent {
            id: card
            width: parent.width
            height: implicitHeight
            theme: panel.theme
            flow: panel.flow
            onFocusMoved: control => {
                // Tab navigation must keep the focused control visible on short displays.
                Qt.callLater(() => {
                    const top = control.mapToItem(card, 0, 0).y - 8;
                    const bottom = top + control.height + 16;
                    const viewport = scroll.contentItem;
                    const offset = top < viewport.contentY ? top
                        : bottom > viewport.contentY + scroll.availableHeight ? bottom - scroll.availableHeight
                        : viewport.contentY;
                    viewport.contentY = Math.max(0, Math.min(offset, card.height - scroll.availableHeight));
                });
            }
        }
    }
}
