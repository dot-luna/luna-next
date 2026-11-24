pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic

FocusScope {
    id: strip
    required property var theme
    required property var workspaceIds
    required property int activeWorkspace
    /** Absolute SVG paths keyed by workspace ID; the active workspace shows its icon, not its number. */
    property var icons: ({})
    /** Slots shown at once; the strip scrolls only as far as needed to reveal the selection. */
    property int visibleCount: 4
    property int first: 0
    readonly property int slotWidth: 20
    signal activated(int workspace)
    signal dismissed()
    /** Tab past the last workspace, or Shift+Tab before the first. */
    signal leaving(int direction)
    implicitWidth: Math.min(buttons.count, visibleCount) * slotWidth
    implicitHeight: 26

    function activeIndex() {
        return workspaceIds ? workspaceIds.indexOf(activeWorkspace) : -1;
    }
    function focusActive() {
        focusIndex(Math.max(0, activeIndex()));
    }
    function focusIndex(index) {
        const item = buttons.itemAt(index);
        if (item) item.forceActiveFocus(Qt.TabFocusReason);
    }
    function focusedIndex() {
        for (let i = 0; i < buttons.count; i++) {
            if (buttons.itemAt(i).activeFocus) return i;
        }
        return -1;
    }
    function step(direction) {
        if (!buttons.count) return;
        focusIndex((focusedIndex() + direction + buttons.count) % buttons.count);
    }
    function tab(direction) {
        const next = focusedIndex() + direction;
        if (next < 0 || next >= buttons.count) leaving(direction);
        else focusIndex(next);
    }
    function reveal(index) {
        if (index < 0) return;
        let next = first;
        if (index < next) next = index;
        else if (index > next + visibleCount - 1) next = index - visibleCount + 1;
        first = Math.max(0, Math.min(next, buttons.count - visibleCount));
    }
    // Keyboard focus wins over the active workspace, so list changes never scroll it away.
    function revealSelection() {
        const focused = focusedIndex();
        reveal(focused >= 0 ? focused : activeIndex());
    }
    onActiveWorkspaceChanged: revealSelection()
    onWorkspaceIdsChanged: Qt.callLater(revealSelection)
    onVisibleCountChanged: revealSelection()
    Keys.onEscapePressed: dismissed()
    Keys.onLeftPressed: step(-1)
    Keys.onRightPressed: step(1)

    WheelHandler {
        onWheel: event => {
            const direction = event.angleDelta.y > 0 || event.angleDelta.x > 0 ? -1 : 1;
            strip.first = Math.max(0, Math.min(strip.first + direction, buttons.count - strip.visibleCount));
        }
    }

    Item {
        anchors.fill: parent
        clip: true
        Row {
            id: row
            x: -strip.first * strip.slotWidth
            Behavior on x { NumberAnimation { duration: 180; easing.type: Easing.OutCubic } }
            Repeater {
                id: buttons
                model: strip.workspaceIds
                delegate: Button {
                    id: button
                    required property int modelData
                    required property int index
                    readonly property bool selected: modelData === strip.activeWorkspace
                    readonly property string iconPath: strip.icons[String(modelData)] || ""
                    objectName: "workspace-" + modelData
                    width: strip.slotWidth
                    height: strip.implicitHeight
                    focusPolicy: Qt.StrongFocus
                    Accessible.name: "Workspace " + modelData
                    Accessible.role: Accessible.Button
                    Accessible.description: selected ? "Active workspace" : "Switch workspace"
                    onClicked: strip.activated(modelData)
                    onActiveFocusChanged: if (activeFocus) strip.reveal(index)
                    Keys.onReturnPressed: click()
                    Keys.onEnterPressed: click()
                    // Handled on the button: Qt's own Tab focus chain would consume it first.
                    Keys.onTabPressed: event => strip.tab(event.modifiers & Qt.ShiftModifier ? -1 : 1)
                    Keys.onBacktabPressed: strip.tab(-1)
                    background: Rectangle {
                        color: button.hovered ? strip.theme.colors.selection : "transparent"
                        radius: Math.min(strip.theme.appearance.rounding, height / 2)
                        border.width: button.visualFocus ? 1 : 0
                        border.color: strip.theme.colors.accent
                        Behavior on color { ColorAnimation { duration: 100 } }
                    }
                    contentItem: Item {
                        Item {
                            anchors.fill: parent
                            opacity: button.selected ? 1 : 0
                            Behavior on opacity { NumberAnimation { duration: 140 } }
                            Icon {
                                id: icon
                                anchors.centerIn: parent
                                width: 16
                                height: 16
                                visible: ready
                                path: button.iconPath
                                ink: strip.theme.colors.accent
                            }
                            Text {
                                anchors.centerIn: parent
                                visible: !icon.ready
                                text: button.modelData === 10 ? "0" : String(button.modelData)
                                color: strip.theme.colors.accent
                                font.family: strip.theme.fonts.ui
                                font.pixelSize: 12
                                font.bold: true
                            }
                        }
                        Rectangle {
                            anchors.centerIn: parent
                            width: 5
                            height: 5
                            radius: 2.5
                            color: strip.theme.colors.foreground
                            opacity: button.selected ? 0 : button.hovered ? 0.9 : 0.5
                            Behavior on opacity { NumberAnimation { duration: 100 } }
                        }
                    }
                }
            }
        }
    }
}
