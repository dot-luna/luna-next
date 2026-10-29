pragma ComponentBehavior: Bound

import QtQuick
import Quickshell.Io
import "Wallpaper.js" as Wallpaper

Process {
    id: inspection

    required property string sourcePath
    property bool finished: false
    signal identified(string kind)
    signal failed(string message)

    command: ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name:format=format_name", "-of", "json", "-i", sourcePath]
    running: true
    stdout: StdioCollector {
        id: metadata
    }
    stderr: SplitParser {}

    onExited: code => {
        finished = true;
        try {
            identified(code === 0 ? Wallpaper.mediaKind(JSON.parse(metadata.text)) : "image");
        } catch (error) {
            failed("Could not identify media: " + error.message);
        }
    }

    // Missing ffprobe need not prevent Qt from displaying a valid image.
    onRunningChanged: if (!running)
        Qt.callLater(function () {
            if (!inspection.finished) {
                inspection.finished = true;
                inspection.identified("image");
            }
        })
}
