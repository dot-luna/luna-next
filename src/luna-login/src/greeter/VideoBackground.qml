import QtQuick
import QtMultimedia

Item {
    id: root
    property url mediaSource: ""
    property string fit: "fill"
    clip: true

    VideoOutput {
        id: output
        objectName: "videoOutput"
        anchors.centerIn: parent
        width: root.fit === "center" || root.fit === "tile" ? (sourceRect.width || parent.width) : parent.width
        height: root.fit === "center" || root.fit === "tile" ? (sourceRect.height || parent.height) : parent.height
        fillMode: root.fit === "stretch" ? VideoOutput.Stretch : root.fit === "fit" ? VideoOutput.PreserveAspectFit : VideoOutput.PreserveAspectCrop
    }

    MediaPlayer {
        id: player
        objectName: "videoPlayer"
        source: root.mediaSource
        videoOutput: output
        audioOutput: AudioOutput {
            muted: true
            volume: 0
        }
        loops: MediaPlayer.Infinite
        onMediaStatusChanged: if (mediaStatus === MediaPlayer.LoadedMedia)
            play()
    }
}
