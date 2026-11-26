pragma ComponentBehavior: Bound
// Quickshell exports these model/screen members at runtime, but omits them from qmltypes.
// qmllint disable missing-property
import QtQuick
import Quickshell
import Quickshell.Services.SystemTray

BarPopup {
    id: popup
    side: "right"
    namespace: "luna-bar-tray"
    implicitWidth: 240
    implicitHeight: Math.min(list.implicitHeight + 20, screen ? screen.height - top - 16 : 600)
    onOpenChanged: if (open) list.forceActiveFocus()

    PanelScroll {
        anchors.fill: parent
        anchors.margins: 10
        contentHeight: list.implicitHeight
        Column {
            id: list
            width: parent.width
            Keys.onEscapePressed: popup.open = false
            Repeater {
                model: SystemTray.items
                Item {
                    id: entry
                    required property var modelData
                    width: list.width
                    height: 34
                    function showMenu() {
                        popup.menuOpen = true;
                        menu.open();
                        if (!menu.visible) popup.menuOpen = false;
                    }
                    ListRow {
                        width: parent.width - (entry.modelData.hasMenu && !entry.modelData.onlyMenu ? 28 : 0)
                        theme: popup.theme
                        label: entry.modelData.title || entry.modelData.tooltipTitle || entry.modelData.id
                        image: entry.modelData.icon
                        onClicked: {
                            if (entry.modelData.onlyMenu) entry.showMenu();
                            else { entry.modelData.activate(); popup.open = false; }
                        }
                    }
                    IconButton {
                        anchors.right: parent.right
                        theme: popup.theme
                        iconName: "arrow-right-01"
                        visible: entry.modelData.hasMenu && !entry.modelData.onlyMenu
                        Accessible.name: "App menu"
                        onClicked: entry.showMenu()
                    }
                    QsMenuAnchor {
                        id: menu
                        menu: entry.modelData.menu
                        onClosed: popup.menuOpen = false
                        anchor.window: popup
                        anchor.rect.x: popup.width
                        anchor.rect.y: entry.y + 10
                    }
                }
            }
            PanelText {
                theme: popup.theme
                visible: SystemTray.items.values.length === 0
                text: "No tray apps"
                opacity: 0.6
            }
        }
    }
}
