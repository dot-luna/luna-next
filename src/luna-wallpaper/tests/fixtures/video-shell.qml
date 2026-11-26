import QtQuick
import Quickshell
import Quickshell.Io
ShellRoot {
    id: shell
    property string failure: ""
    property var video: player.item
    Loader { id: player; active: false }
    IpcHandler {
        target: "test"
        function state(): string {
            return JSON.stringify({status: video ? video.status : "absent", error: failure,
                directory: video ? video.privateDirectory : "",
                diagnostic: video ? video.lastPlayerError : "",
                connected: video ? video.connectedOnce : false});
        }
        function start(path: string, fit: string): void {
            failure = "";
            player.active = true;
            player.setSource("VideoWallpaper.qml", {sourcePath: path, outputName: "DP-1",
                fit: fit, startupTimeout: 1600});
            player.item.failed.connect(function(message) { failure = message; });
        }
        function pause(value: bool): void { video.paused = value; }
        function load(path: string): void { video.load(path); }
        function settings(fit: string, color: string): void {
            video.fit = fit;
            video.backgroundColor = color;
        }
        function destroy(): void { player.active = false; }
    }
}
