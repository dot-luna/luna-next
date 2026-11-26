pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Effects

Rectangle {
    id: background
    required property var settings
    readonly property var blurSettings: settings.theme.appearance.blur
    // Map Luna's blur size/passes to a bounded Qt blur radius.
    readonly property real blurRadius: Math.min(256, blurSettings.size * blurSettings.passes)
    color: settings.theme.colors.background
    clip: true

    Image {
        id: image
        objectName: "backgroundImage"
        anchors.fill: parent
        anchors.margins: background.blurSettings.enabled ? -Math.ceil(background.blurRadius) : 0
        source: background.settings.background.path
        fillMode: Image.PreserveAspectCrop
        asynchronous: true
        visible: false
    }
    MultiEffect {
        objectName: "backgroundEffect"
        anchors.fill: image
        source: image
        visible: image.status === Image.Ready
        autoPaddingEnabled: false
        blurEnabled: background.blurSettings.enabled
        blurMax: Math.max(2, Math.min(64, Math.ceil(background.blurRadius / 2) * 2))
        blurMultiplier: Math.max(0, background.blurRadius / 64 - 1)
        blur: 1
        saturation: -0.2
        brightness: -0.12
    }
    Rectangle {
        anchors.fill: parent
        gradient: Gradient {
            GradientStop {
                position: 0
                color: Qt.alpha(background.settings.theme.colors.background, 0.20)
            }
            GradientStop {
                position: 0.6
                color: Qt.alpha(background.settings.theme.colors.background, 0.38)
            }
            GradientStop {
                position: 1
                color: Qt.alpha(background.settings.theme.colors.background, 0.72)
            }
        }
    }
}
