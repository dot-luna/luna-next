pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Effects

Item {
    id: icon
    required property string name
    required property color ink
    implicitWidth: 19
    implicitHeight: 19

    Image {
        anchors.fill: parent
        source: Qt.resolvedUrl("icons/" + icon.name + ".svg")
        sourceSize: Qt.size(width, height)
        fillMode: Image.PreserveAspectFit
        layer.enabled: true
        layer.effect: MultiEffect {
            colorization: 1
            colorizationColor: icon.ink
        }
    }
}
