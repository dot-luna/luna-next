pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Effects

// Tint a white-stroked SVG, such as the bundled free Hugeicons; keep icons/LICENSE.md with them.
Item {
    id: icon
    required property color ink
    /** A bundled icon from icons/, such as "wifi-01". */
    property string name: ""
    /** Absolute SVG path; defaults to the bundled `name`. */
    property string path: name ? decodeURIComponent(Qt.resolvedUrl("icons/" + name + ".svg").toString().replace(/^file:\/\//, "")) : ""
    readonly property bool ready: image.status === Image.Ready

    implicitWidth: 16
    implicitHeight: 16

    Image {
        id: image
        anchors.fill: parent
        fillMode: Image.PreserveAspectFit
        source: icon.path ? "file://" + icon.path.split("/").map(encodeURIComponent).join("/") : ""
        sourceSize: Qt.size(width, height)
        layer.enabled: true
        layer.effect: MultiEffect {
            colorization: 1
            colorizationColor: icon.ink
        }
    }
}
