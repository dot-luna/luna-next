pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Effects

// Tint bundled free Hugeicons vectors; retain icons/LICENSE.md when redistributing.
Item {
    id: icon

    required property color ink
    required property string name

    implicitHeight: 18
    implicitWidth: 18

    Image {
        anchors.fill: parent
        fillMode: Image.PreserveAspectFit
        layer.enabled: true
        source: Qt.resolvedUrl("icons/" + icon.name + ".svg")
        sourceSize: Qt.size(width, height)

        layer.effect: MultiEffect {
            colorization: 1
            colorizationColor: icon.ink
        }
    }
}
