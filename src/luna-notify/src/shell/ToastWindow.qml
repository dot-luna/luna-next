pragma ComponentBehavior: Bound
import QtQuick
import Quickshell
import Quickshell.Wayland

PanelWindow {
    id: panel
    required property var theme
    required property var settings
    required property var store
    property bool keyboard: false
    property var cardItems: []
    readonly property bool expanded: keyboard || (settings.stack.expand_on_hover && stackHover.hovered)
    readonly property real frontHeight: cardItems.length ? cardItems[cardItems.length - 1].implicitHeight : 0
    readonly property real stackHeight: expanded
        ? cardItems.reduce((height, item) => height + item.implicitHeight + settings.stack.gap, -settings.stack.gap)
        : frontHeight + Math.max(0, Math.min(cardItems.length, settings.stack.limit) - 1) * settings.stack.peek

    function focusToasts() {
        if (!visible) return;
        keyboard = true;
        const card = cardItems[cardItems.length - 1];
        if (card) card.focusToast();
    }
    function position(index) {
        if (!expanded) return Math.min(cardItems.length - index - 1, settings.stack.limit - 1) * settings.stack.peek;
        let y = 0;
        for (let i = cardItems.length - 1; i > index; --i)
            y += cardItems[i].implicitHeight + settings.stack.gap;
        return y;
    }
    anchors { top: true; right: true }
    readonly property int gap: Math.max(12, theme.appearance.gaps.outer)
    margins { top: gap; right: gap }
    implicitWidth: Math.min(settings.appearance.width, screen ? screen.width - gap * 2 : settings.appearance.width)
    implicitHeight: Math.min(Math.max(0, stackHeight), screen ? screen.height - gap * 2 : Math.max(0, stackHeight))
    color: "transparent"
    visible: store.notifications.length > 0
    exclusionMode: ExclusionMode.Ignore
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.namespace: "luna-notify"
    WlrLayershell.keyboardFocus: keyboard ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None
    onVisibleChanged: if (!visible) keyboard = false

    Flickable {
        id: scroll
        anchors.fill: parent
        contentHeight: Math.max(0, panel.stackHeight)
        contentWidth: width
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        Item {
            id: stack
            width: scroll.width
            height: scroll.contentHeight
            HoverHandler { id: stackHover }
            Repeater {
                id: cards
                model: panel.store.server.trackedNotifications
                onItemAdded: (index, item) => {
                    const items = panel.cardItems.slice();
                    items.splice(index, 0, item);
                    panel.cardItems = items;
                }
                onItemRemoved: (index, item) => {
                    const items = panel.cardItems.slice();
                    items.splice(index, 1);
                    panel.cardItems = items;
                    if (panel.keyboard) panel.focusToasts();
                }
                delegate: ToastCard {
                    required property var modelData
                    required property int index
                    readonly property int depth: panel.cardItems.length - index - 1
                    readonly property int visualDepth: Math.min(depth, panel.settings.stack.limit - 1)
                    notification: modelData
                    theme: panel.theme
                    settings: panel.settings
                    keyboardMode: panel.keyboard
                    exposed: panel.expanded || depth === 0
                    enabled: exposed
                    z: index
                    x: panel.expanded ? 0 : visualDepth * panel.settings.stack.inset
                    y: panel.position(index)
                    width: stack.width - (panel.expanded ? 0 : visualDepth * panel.settings.stack.inset * 2)
                    height: panel.expanded || depth === 0 ? implicitHeight : panel.frontHeight
                    KeyNavigation.tab: panel.cardItems[index > 0 ? index - 1 : panel.cardItems.length - 1] || null
                    KeyNavigation.backtab: panel.cardItems[index < panel.cardItems.length - 1 ? index + 1 : 0] || null
                    Behavior on y { NumberAnimation { duration: 160; easing.type: Easing.OutCubic } }
                    Behavior on x { NumberAnimation { duration: 160; easing.type: Easing.OutCubic } }
                    Behavior on width { NumberAnimation { duration: 160; easing.type: Easing.OutCubic } }
                    onOpened: panel.keyboard = false
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
