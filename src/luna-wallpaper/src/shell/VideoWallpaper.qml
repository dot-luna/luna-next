pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Io
import "Video.js" as Video

// One owned player per Loader instance. Recreate the component to change media.
Item {
    id: root

    property string sourcePath: ""
    property string outputName: ""
    property string fit: "fill"
    property color backgroundColor: "#000000"
    property bool paused: false
    readonly property string status: stateValue
    signal failed(string message)

    property string stateValue: "loading"
    property string privateDirectory: ""
    property string lastPlayerError: ""
    property bool stopping: false
    property bool connectedOnce: false
    property bool directoryAttempted: false
    property bool directoryFinished: false
    property bool playerAttempted: false
    property int startupTimeout: 15000

    function send(command, requestId) {
        if (ipc.connected && !stopping) {
            ipc.write(JSON.stringify({
                command: command,
                request_id: requestId || 0
            }) + "\n");
            ipc.flush();
        }
    }

    function removeDirectory() {
        if (privateDirectory) {
            Quickshell.execDetached(["rm", "-r", "--", privateDirectory]);
            privateDirectory = "";
        }
    }

    // Disconnect before stopping the child so expected shutdown is not an error.
    function stop() {
        stopping = true;
        deadline.stop();
        connectionRetry.stop();
        ipc.connected = false;
        if (player.running) {
            player.running = false;
            stopDeadline.start();
        } else if (!directory.running) {
            removeDirectory();
        }
    }

    function fail(message) {
        if (stopping)
            return;
        stateValue = "error";
        stop();
        failed(message);
    }

    function begin() {
        if (!sourcePath.startsWith("/")) {
            fail("Video wallpaper requires an absolute local media path.");
            return;
        }
        if (!outputName || /\s/.test(outputName) || outputName.toUpperCase() === "ALL") {
            fail("Video wallpaper requires one display connector name.");
            return;
        }

        const runtime = Quickshell.env("XDG_RUNTIME_DIR") || "/tmp";
        directory.command = ["mktemp", "-d", "--", runtime + "/luna-wp.XXXXXX"];
        directoryAttempted = true;
        deadline.start();
        directory.running = true;
    }

    function receive(line) {
        if (stopping)
            return;
        let message;
        try {
            message = JSON.parse(line);
            if (message === null || typeof message !== "object" || Array.isArray(message))
                throw new Error("Invalid IPC object");
        } catch (error) {
            fail("Video player returned invalid IPC data.");
            return;
        }

        if (message.event === "end-file" || message.event === "shutdown") {
            fail("Video playback stopped" + (message.error ? ": " + message.error : "."));
        } else if (message.event === "log-message" && (message.level === "error" || message.level === "fatal")) {
            // Decoders can recover from these diagnostics (including hardware
            // decoding fallback). Terminal events and deadlines decide failure.
            lastPlayerError = String(message.text || "unknown error").slice(-600).trim();
        } else if (message.event === "video-reconfig" || message.event === "file-loaded") {
            send(["get_property", "video-out-params"], 1);
        } else if ((message.request_id === 1 && message.error === "success") || (message.event === "property-change" && message.name === "video-out-params")) {
            // A live process/socket alone does not establish that video decoded.
            if (Video.videoReady(message.data)) {
                stateValue = "ready";
                deadline.stop();
            }
        } else if (message.request_id === 2 && message.error !== "success") {
            fail("Video player could not update playback: " + message.error);
        }
    }

    Component.onCompleted: begin()
    Component.onDestruction: {
        stopping = true;
        ipc.connected = false;
        // Destruction also handles a child that ignores graceful termination.
        if (Number(player.processId) > 0)
            player.signal(9);
        if (!privateDirectory)
            privateDirectory = directoryOutput.text.trim();
        removeDirectory();
    }
    onPausedChanged: send(["set_property", "pause", paused], 2)

    Process {
        id: directory
        stdout: StdioCollector {
            id: directoryOutput
            waitForEnd: false
        }
        stderr: SplitParser {}
        onRunningChanged: if (!running && root.directoryAttempted)
            Qt.callLater(() => {
                if (!root.directoryFinished && !root.stopping)
                    root.fail("Could not create the video player's private runtime directory.");
            })
        onExited: code => {
            root.directoryFinished = true;
            root.privateDirectory = directoryOutput.text.trim();
            if (root.stopping) {
                root.removeDirectory();
                return;
            }
            if (code !== 0 || !root.privateDirectory) {
                root.fail("Could not create the video player's private runtime directory.");
                return;
            }
            // Keep Unix socket paths below the platform limit.
            if ((root.privateDirectory + "/ipc").length > 100) {
                root.fail("The video player's runtime socket path is too long.");
                return;
            }
            ipc.path = root.privateDirectory + "/ipc";
            player.workingDirectory = root.privateDirectory;
            // mpvpaper reads HOME/.config/mpvpaper independently of mpv's config=no.
            player.environment = {
                HOME: root.privateDirectory
            };
            player.command = ["mpvpaper", "--layer", "bottom", "--mpv-options", Video.options(root.fit, root.backgroundColor.toString(), root.paused), "--", root.outputName, root.sourcePath];
            root.playerAttempted = true;
            player.running = true;
        }
    }

    Process {
        id: player
        stdout: SplitParser {}
        stderr: SplitParser {
            onRead: line => {
                root.lastPlayerError = line.slice(-600).trim();
            }
        }
        onStarted: connectionRetry.start()
        onRunningChanged: if (!running && root.playerAttempted)
            Qt.callLater(() => {
                if (root.playerAttempted && !root.stopping)
                    root.fail("Could not start mpvpaper; install the wallpaper video dependency.");
            })
        onExited: code => {
            root.playerAttempted = false;
            stopDeadline.stop();
            if (!root.stopping)
                root.fail("Video player exited (" + code + ")" + (root.lastPlayerError ? ": " + root.lastPlayerError : "."));
            root.removeDirectory();
        }
    }

    Socket {
        id: ipc
        parser: SplitParser {
            onRead: line => root.receive(line)
        }
        onConnectionStateChanged: {
            if (connected && !root.stopping) {
                root.connectedOnce = true;
                connectionRetry.stop();
                // Property notifications replace polling after the first connection.
                root.send(["request_log_messages", "error"]);
                root.send(["observe_property", 1, "video-out-params"]);
                root.send(["get_property", "video-out-params"], 1);
                root.send(["set_property", "pause", root.paused], 2);
            } else if (!connected && root.connectedOnce && !root.stopping) {
                root.fail("Video player IPC connection closed.");
            }
        }
        onError: {
            // Let the native socket's error callback finish before disconnecting it.
            if (root.connectedOnce && !root.stopping)
                Qt.callLater(() => root.fail("Video player IPC failed."));
        }
    }

    Timer {
        id: connectionRetry
        interval: 250
        repeat: true
        onTriggered: if (!ipc.connected)
            ipc.connected = true
    }
    Timer {
        id: deadline
        interval: root.startupTimeout
        onTriggered: root.fail("Video wallpaper did not become ready before the startup timeout.")
    }
    Timer {
        id: stopDeadline
        interval: 1500
        onTriggered: if (Number(player.processId) > 0)
            player.signal(9)
    }
}
