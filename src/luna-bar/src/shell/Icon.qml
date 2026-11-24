pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Effects

// Tint a white-stroked SVG, such as the bundled free Hugeicons; keep icons/LICENSE.md with them.
Item {
    id: icon
    required property color ink
    /** Absolute SVG path; bundled names are resolved by the API before the shell starts. */
    required property string path
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
