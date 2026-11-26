pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Shapes
import Luna.UI 1.0 as UI

Rectangle {
    id: tile
    required property UI.Theme theme
    property bool busy: false
    function focusImport() { local.forceActiveFocus(); }
    signal chooseFile()
    signal chooseUrl()
    signal reveal(Item target)
    implicitHeight: width * 0.64
    color: "transparent"
    radius: theme.rounding
    border.color: theme.line
    border.width: Math.max(1, theme.borderWidth)

    Item {
        id: split
        anchors.fill: parent
        anchors.margins: 6
        UI.Button {
            id: local
            objectName: "importBackgroundFile"
            anchors.fill: parent
            theme: tile.theme
            variant: UI.Button.Ghost
            horizontalPadding: 0
            verticalPadding: 0
            enabled: !tile.busy
            Accessible.name: "Install wallpaper from file"
            onClicked: tile.chooseFile()
            onActiveFocusChanged: if (activeFocus) tile.reveal(tile)
            // Bound the half-plane to the tile so it cannot intercept nearby controls.
            containmentMask: QtObject {
                function contains(point: point): bool { return split.contains(point) && point.x / split.width + point.y / split.height <= 1; }
            }
            background: Shape {
                ShapePath {
                    strokeColor: local.visualFocus ? tile.theme.accent : "transparent"
                    strokeWidth: 1
                    fillColor: local.hovered || local.visualFocus ? tile.theme.raised : "transparent"
                    startX: 1; startY: 1
                    PathLine { x: split.width - 1; y: 1 }
                    PathLine { x: 1; y: split.height - 1 }
                    PathLine { x: 1; y: 1 }
                }
            }
            contentItem: Item {
                SettingsIcon {
                    x: split.width * 0.28 - width / 2
                    y: split.height * 0.28 - height / 2
                    width: 23; height: 23
                    name: "add-01"; ink: tile.theme.text
                }
            }
        }
        UI.Button {
            id: remote
            objectName: "importBackgroundUrl"
            anchors.fill: parent
            theme: tile.theme
            variant: UI.Button.Ghost
            horizontalPadding: 0
            verticalPadding: 0
            enabled: !tile.busy
            Accessible.name: "Download wallpaper from URL"
            onClicked: tile.chooseUrl()
            onActiveFocusChanged: if (activeFocus) tile.reveal(tile)
            containmentMask: QtObject {
                function contains(point: point): bool { return split.contains(point) && point.x / split.width + point.y / split.height > 1; }
            }
            background: Shape {
                ShapePath {
                    strokeColor: remote.visualFocus ? tile.theme.accent : "transparent"
                    strokeWidth: 1
                    fillColor: remote.hovered || remote.visualFocus ? tile.theme.raised : "transparent"
                    startX: split.width - 1; startY: 1
                    PathLine { x: split.width - 1; y: split.height - 1 }
                    PathLine { x: 1; y: split.height - 1 }
                    PathLine { x: split.width - 1; y: 1 }
                }
            }
            contentItem: Item {
                SettingsIcon {
                    x: split.width * 0.72 - width / 2
                    y: split.height * 0.72 - height / 2
                    width: 23; height: 23
                    name: "download-01"; ink: tile.theme.text
                }
            }
        }
        Shape {
            anchors.fill: parent
            ShapePath {
                strokeColor: tile.theme.line
                strokeWidth: 1
                startX: split.width; startY: 0
                PathLine { x: 0; y: split.height }
            }
        }
    }
}
