pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Io
import "Video.js" as Video

// Keep one owned player and surface while changing video or rendering options.
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
    property string playerSourcePath: ""
    property int mediaGeneration: 0
    property int nextRequestId: 0
    property var pendingRequests: ({})
    property bool mediaEventSeen: false
    property bool replacing: false
    property bool decodedVideo: false

    function send(command, kind) {
        if (ipc.connected && !stopping) {
            const requestId = ++nextRequestId;
            if (kind)
                pendingRequests[requestId] = {kind: kind, generation: mediaGeneration};
            if (kind === "update" && stateValue === "ready") {
                stateValue = "loading";
                deadline.restart();
            }
            ipc.write(JSON.stringify({
                command: command,
                request_id: requestId
            }) + "\n");
            ipc.flush();
        }
    }

    function finishUpdate() {
        if (!decodedVideo || stopping)
            return;
        for (const key of Object.keys(pendingRequests)) {
            const request = pendingRequests[key];
            if (request.kind === "update")
                return;
        }
        stateValue = "ready";
        replacing = false;
        deadline.stop();
    }

    function updateFit() {
        const mode = Video.sizing(fit);
        send(["set_property", "keepaspect", mode.keepaspect], "update");
        send(["set_property", "panscan", mode.panscan], "update");
        send(["set_property", "video-unscaled", mode.unscaled], "update");
    }

    function queryVideo() {
        if (!mediaEventSeen)
            return;
        send(["get_property", "path"], "path");
    }

    function replaceVideo() {
        replacing = true;
        playerSourcePath = sourcePath;
        send(["loadfile", sourcePath, "replace"], "load");
    }

    // Settings changes stay on the existing player; loading new media resets
    // readiness before asynchronous IPC can deliver old-file notifications.
    function load(path) {
        if (stopping || path === sourcePath)
            return;
        if (!path.startsWith("/")) {
            fail("Video wallpaper requires an absolute local media path.");
            return;
        }
        sourcePath = path;
        stateValue = "loading";
        lastPlayerError = "";
        mediaGeneration++;
        // Setting commands affect the same player across file switches. Their
        // acknowledgements must still complete before this reload can succeed.
        const updates = {};
        for (const key of Object.keys(pendingRequests)) {
            if (pendingRequests[key].kind === "update")
                updates[key] = pendingRequests[key];
        }
        pendingRequests = updates;
        mediaEventSeen = false;
        decodedVideo = false;
        deadline.restart();
        if (ipc.connected)
            replaceVideo();
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

    function startPlayer() {
        // Keep Unix socket paths below the platform limit.
        if ((privateDirectory + "/ipc").length > 100) {
            fail("The video player's runtime socket path is too long.");
            return;
        }
        ipc.path = privateDirectory + "/ipc";
        player.workingDirectory = privateDirectory;
        // mpvpaper reads HOME/.config/mpvpaper independently of mpv's config=no.
        player.environment = {
            HOME: privateDirectory
        };
        player.command = ["mpvpaper", "--layer", "bottom", "--mpv-options", Video.options(fit, backgroundColor.toString(), paused), "--", outputName, sourcePath];
        playerSourcePath = sourcePath;
        playerAttempted = true;
        player.running = true;
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
            if (message.event === "end-file" && message.reason === "stop" && replacing)
                return;
            const error = message.file_error || message.error;
            fail("Video playback stopped" + (error ? ": " + error : "."));
        } else if (message.event === "log-message" && (message.level === "error" || message.level === "fatal")) {
            // Decoders can recover from these diagnostics (including hardware
            // decoding fallback). Terminal events and deadlines decide failure.
            lastPlayerError = String(message.text || "unknown error").slice(-600).trim();
        } else if (message.event === "video-reconfig" || message.event === "file-loaded") {
            mediaEventSeen = true;
            queryVideo();
        } else if (message.event === "property-change" && message.name === "video-out-params") {
            queryVideo();
        } else if (Object.prototype.hasOwnProperty.call(pendingRequests, message.request_id)) {
            const request = pendingRequests[message.request_id];
            delete pendingRequests[message.request_id];
            if (request.generation !== mediaGeneration && request.kind !== "update")
                return;
            // Read the source before querying dimensions. Unsolicited property
            // events and replies from earlier loads cannot establish readiness.
            if (request.kind === "path") {
                if (message.error === "success" && message.data === sourcePath)
                    send(["get_property", "video-out-params"], "parameters");
            } else if (request.kind === "parameters") {
                if (message.error !== "success" || !Video.videoReady(message.data))
                    return;
                decodedVideo = true;
                finishUpdate();
            } else if (message.error !== "success") {
                fail("Video player could not update playback: " + message.error);
            } else if (request.kind === "update") {
                finishUpdate();
            }
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
    onPausedChanged: send(["set_property", "pause", paused], "update")
    onFitChanged: updateFit()
    onBackgroundColorChanged: send(["set_property", "background-color", backgroundColor.toString()], "update")

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
            root.startPlayer();
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
                root.send(["request_log_messages", "error"], "setup");
                root.send(["observe_property", 1, "video-out-params"], "setup");
                if (root.playerSourcePath !== root.sourcePath) {
                    root.replaceVideo();
                } else {
                    // The first file can finish loading before IPC connects.
                    root.mediaEventSeen = true;
                    root.queryVideo();
                }
                root.updateFit();
                root.send(["set_property", "background-color", root.backgroundColor.toString()], "update");
                root.send(["set_property", "pause", root.paused], "update");
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
