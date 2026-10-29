pragma ComponentBehavior: Bound

import QtQuick
import "Wallpaper.js" as Wallpaper

Loader {
    id: frame

    // Keep a slot's source independent while its replacement is being decoded.
    property string sourcePath: ""
    property string mediaKind: "image"
    property string fit: "fill"
    property int fillMode: Image.PreserveAspectCrop
    property bool paused: false
    property real pixelRatio: 1
    signal decoded(int status)

    sourceComponent: mediaKind === "animated" ? animated : still
    onLoaded: decoded(item.status)

    Component {
        id: still
        Image {
            source: Wallpaper.fileUrl(frame.sourcePath)
            fillMode: frame.fillMode
            asynchronous: true
            cache: false
            autoTransform: true
            smooth: frame.fit !== "center" && frame.fit !== "tile"
            mipmap: smooth
            sourceSize: /\.svg$/i.test(frame.sourcePath) && smooth ? Qt.size(frame.width * frame.pixelRatio, frame.height * frame.pixelRatio) : undefined
            onStatusChanged: frame.decoded(status)
        }
    }

    Component {
        id: animated
        AnimatedImage {
            source: Wallpaper.fileUrl(frame.sourcePath)
            fillMode: frame.fillMode
            asynchronous: true
            cache: false
            smooth: frame.fit !== "center" && frame.fit !== "tile"
            mipmap: smooth
            paused: frame.paused
            onStatusChanged: frame.decoded(status)
            function repeatAnimation() {
                if (status === Image.Ready && frameCount > 1) {
                    currentFrame = 0;
                    playing = true;
                }
            }
            // Restart finite-loop files without mutating the decoder during its signal.
            onPlayingChanged: if (!playing)
                Qt.callLater(repeatAnimation)
        }
    }
}
