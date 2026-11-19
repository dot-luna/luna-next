pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic

FocusScope {
    id: strip
    required property var theme
    required property var workspaceIds
    required property int activeWorkspace
    signal activated(int workspace)
    signal dismissed()
    implicitWidth: row.implicitWidth
    implicitHeight: 26

    function focusActive() {
        const index = Math.max(0, workspaceIds.indexOf(activeWorkspace));
        const item = buttons.itemAt(index);
        if (item) item.forceActiveFocus(Qt.TabFocusReason);
    }
    function step(direction) {
        if (!buttons.count) return;
        let current = -1;
        for (let i = 0; i < buttons.count; i++) {
            if (buttons.itemAt(i).activeFocus) current = i;
        }
        buttons.itemAt((current + direction + buttons.count) % buttons.count).forceActiveFocus(Qt.TabFocusReason);
    }
    Keys.onEscapePressed: dismissed()
    Keys.onLeftPressed: step(-1)
    Keys.onRightPressed: step(1)
    Keys.onTabPressed: step(1)
    Keys.onBacktabPressed: step(-1)

    Row {
        id: row
        spacing: 2
        Repeater {
            id: buttons
            model: strip.workspaceIds
            delegate: Button {
                id: button
                required property int modelData
                readonly property bool selected: modelData === strip.activeWorkspace
                objectName: "workspace-" + modelData
                width: 24
                height: strip.implicitHeight
                focusPolicy: Qt.StrongFocus
                Accessible.name: "Workspace " + modelData
                Accessible.role: Accessible.Button
                Accessible.description: selected ? "Active workspace" : "Switch workspace"
                onClicked: strip.activated(modelData)
                Keys.onReturnPressed: click()
                Keys.onEnterPressed: click()
                background: Rectangle {
                    color: button.hovered ? strip.theme.colors.selection : "transparent"
                    radius: Math.min(strip.theme.appearance.rounding, height / 2)
                    border.width: button.visualFocus ? 1 : 0
                    border.color: strip.theme.colors.accent
                    Behavior on color { ColorAnimation { duration: 100 } }
                }
                contentItem: Item {
                    Text {
                        anchors.centerIn: parent
                        visible: button.selected
                        text: button.modelData === 10 ? "0" : String(button.modelData)
                        color: strip.theme.colors.accent
                        font.family: strip.theme.fonts.ui
                        font.pixelSize: 12
                        font.bold: true
                    }
                    Rectangle {
                        anchors.centerIn: parent
                        visible: !button.selected
                        width: 5
                        height: 5
                        radius: 2.5
                        color: strip.theme.colors.foreground
                        opacity: button.hovered ? 0.9 : 0.5
                        Behavior on opacity { NumberAnimation { duration: 100 } }
                    }
                }
            }
        }
    }
}
