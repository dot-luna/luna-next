pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Layouts
import Quickshell
import Quickshell.Wayland

PanelWindow {
    id: panel
    required property var theme
    required property var store
    property bool keyboard: false

    function focusToasts() {
        if (!visible) return;
        keyboard = true;
        Qt.callLater(() => {
            const card = cards.itemAt(0);
            if (card) card.focusDismiss();
        });
    }
    anchors { top: true; right: true }
    readonly property int gap: Math.max(12, theme.appearance.gaps.outer)
    margins { top: gap; right: gap }
    implicitWidth: Math.min(380, screen ? screen.width - gap * 2 : 380)
    implicitHeight: Math.min(stack.implicitHeight, screen ? screen.height - gap * 2 : stack.implicitHeight)
    color: "transparent"
    visible: store.notifications.length > 0
    exclusionMode: ExclusionMode.Ignore
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.namespace: "luna-notify"
    // Only an explicit keyboard command can take focus from the active application.
    WlrLayershell.keyboardFocus: keyboard ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None
    onVisibleChanged: if (!visible) keyboard = false

    Flickable {
        id: scroll
        anchors.fill: parent
        contentHeight: stack.implicitHeight
        contentWidth: width
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        ColumnLayout {
            id: stack
            width: parent.width
            spacing: 8
            Repeater {
                id: cards
                model: panel.store.server.trackedNotifications
                onCountChanged: if (panel.keyboard) Qt.callLater(panel.focusToasts)
                delegate: ToastCard {
                    required property var modelData
                    Layout.fillWidth: true
                    notification: modelData
                    theme: panel.theme
                    keyboardMode: panel.keyboard
                    onReleaseFocus: panel.keyboard = false
                    onReveal: item => {
                        const y = item.mapToItem(stack, 0, 0).y;
                        const offset = y < scroll.contentY ? y : Math.max(scroll.contentY, y + item.height - scroll.height);
                        scroll.contentY = Math.max(0, Math.min(offset, scroll.contentHeight - scroll.height));
                    }
                }
            }
        }
    }
}
