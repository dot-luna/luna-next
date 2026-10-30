import QtQuick

Rectangle {
    id: root
    required property var wallpaper
    readonly property url mediaSource: wallpaper.source ? Qt.resolvedUrl(wallpaper.source) : ""
    readonly property int imageFillMode: {
        switch (wallpaper.fit) {
        case "fit":
            return Image.PreserveAspectFit;
        case "stretch":
            return Image.Stretch;
        case "center":
            return Image.Pad;
        case "tile":
            return Image.Tile;
        default:
            return Image.PreserveAspectCrop;
        }
    }

    color: wallpaper.background_color
    clip: true

    AnimatedImage {
        objectName: "backgroundImage"
        anchors.fill: parent
        source: root.wallpaper.type !== "video" ? root.mediaSource : ""
        fillMode: root.imageFillMode
        asynchronous: true
        playing: visible
    }

    // Qt Multimedia is optional for image-only themes. Import it only when a
    // video is selected so a missing codec/module cannot hide login controls.
    Loader {
        objectName: "videoLoader"
        anchors.fill: parent
        active: root.wallpaper.type === "video" && root.mediaSource.toString() !== ""
        function loadVideo() {
            if (active) {
                setSource(Qt.resolvedUrl("VideoBackground.qml"), {
                    mediaSource: Qt.binding(() => root.mediaSource),
                    fit: Qt.binding(() => root.wallpaper.fit)
                });
            } else {
                source = "";
            }
        }
        onActiveChanged: loadVideo()
        Component.onCompleted: loadVideo()
    }
}
