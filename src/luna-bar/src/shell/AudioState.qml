pragma ComponentBehavior: Bound
// Quickshell exports these model/screen members at runtime, but omits them from qmltypes.
// qmllint disable missing-property
import QtQuick
import Quickshell.Services.Pipewire

// One tracker for the shell, shared by every monitor. Stream directions are the inverse
// of device directions: a recording app receives audio, while a speaker receives playback.
Item {
    id: audio
    readonly property var nodes: Pipewire.nodes.values.filter(node => node.audio)
    readonly property var outputs: nodes.filter(node => !node.isStream && node.isSink)
    readonly property var inputs: nodes.filter(node => !node.isStream && !node.isSink)
    readonly property var playback: nodes.filter(node => node.isStream && !node.isSink)
    readonly property var recording: nodes.filter(node => node.isStream && node.isSink)
    readonly property var output: Pipewire.defaultAudioSink
    readonly property var input: Pipewire.defaultAudioSource
    readonly property var activeRecording: recording.filter(node => Pipewire.linkGroups.values.some(
        link => link.target === node && link.state === PwLinkState.Active))
    readonly property string outputIcon: !output || !output.audio || output.audio.muted ? "volume-mute-02"
        : output.audio.volume < 0.5 ? "volume-low" : "volume-high"
    property string error: ""
    readonly property bool selecting: route.running || move.running
    property var pendingMoves: []
    property string targetName: ""
    property bool inputRoute: false

    PwObjectTracker { objects: audio.nodes.concat(Pipewire.linkGroups.values) }

    function label(node) {
        return node.properties["application.name"] || node.description || node.nickname || node.name;
    }
    function select(node, input) {
        if (selecting) return;
        error = "";
        targetName = node.name;
        inputRoute = input;
        if (input) Pipewire.preferredDefaultAudioSource = node;
        else Pipewire.preferredDefaultAudioSink = node;
        // Explicitly move existing streams, including ones previously pinned to a device.
        route.run(["pactl", "--format=json", "list", input ? "source-outputs" : "sink-inputs"]);
    }
    function moveNext() {
        if (!pendingMoves.length) return;
        const id = pendingMoves[0];
        pendingMoves = pendingMoves.slice(1);
        move.run(["pactl", inputRoute ? "move-source-output" : "move-sink-input", String(id), targetName]);
    }
    PanelCommand {
        id: route
        onSucceeded: output => {
            try {
                audio.pendingMoves = JSON.parse(output).map(stream => stream.index);
                audio.moveNext();
            } catch (error) { audio.error = "Could not read app audio"; }
        }
        onFailed: audio.error = "Could not move app audio"
    }
    PanelCommand {
        id: move
        onSucceeded: audio.moveNext()
        onFailed: {
            audio.error = "Some app audio could not be moved";
            audio.moveNext();
        }
    }
}
