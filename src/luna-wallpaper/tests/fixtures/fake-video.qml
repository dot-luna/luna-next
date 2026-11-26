import QtQuick
Item {
    objectName: "fake-video"
    property string sourcePath: ""
    property string outputName: ""
    property string fit: ""
    property color backgroundColor: "#000000"
    property bool paused: false
    property string status: "loading"
    function load(path) {
        sourcePath = path;
        status = "loading";
        Qt.callLater(function () {
            if (sourcePath.endsWith("broken-video.mp4")) {
                status = "error";
                failed("Fake video decoding failure");
            } else {
                status = "ready";
            }
        });
    }
    signal failed(string message)
    Component.onCompleted: load(sourcePath)
}
