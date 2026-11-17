pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Io

// Load one history snapshot per opening; only the selected entry is decoded for preview.
Scope {
    id: history
    property bool active: false
    property string selectedId: ""
    property var entries: []
    property var preview: ({})
    property string error: ""
    property string previewError: ""
    readonly property bool loading: listing.running
    readonly property bool previewLoading: previewProcess.running
    readonly property string launcher: Quickshell.env("HOME") + "/.local/bin/luna"
    property bool listPending: false
    property bool previewPending: false
    property int generation: 0

    function refresh() {
        generation++;
        entries = [];
        preview = {};
        error = "";
        listPending = active;
        Qt.callLater(loadList);
    }
    function loadList() {
        if (!active || !listPending || listing.running) return;
        listPending = false;
        listing.generation = generation;
        listing.finished = false;
        listing.running = true;
    }
    function loadPreview() {
        if (!active || !selectedId || !previewPending || previewProcess.running) return;
        previewPending = false;
        previewProcess.entryId = selectedId;
        previewProcess.generation = generation;
        previewProcess.finished = false;
        previewProcess.exec([launcher, "clipboard", "preview", selectedId, "--json"]);
    }
    function readResponse(text, code) {
        const response = JSON.parse(text);
        if (code !== 0 || !response.succes) throw new Error(response.errMessage || "Clipboard command failed");
        return response.data;
    }
    onActiveChanged: refresh()
    onSelectedIdChanged: {
        preview = {};
        previewError = "";
        previewPending = true;
        Qt.callLater(loadPreview);
    }

    Process {
        id: listing
        property int generation: 0
        property bool finished: false
        command: [history.launcher, "clipboard", "list", "--json"]
        stdout: StdioCollector { id: listOutput }
        onExited: (code, status) => {
            finished = true;
            if (!history.active || generation !== history.generation) return;
            try {
                history.entries = history.readResponse(listOutput.text, code || status).map(entry =>
                    Object.assign({}, entry, {clipboard: true}));
            } catch (error) {
                history.error = "Couldn’t load clipboard history";
                console.warn("Luna clipboard: " + error.message);
            }
        }
        onRunningChanged: if (!running) Qt.callLater(() => {
            if (!listing.running && !listing.finished && history.active)
                history.error = "Couldn’t start clipboard command";
            history.loadList();
        })
    }
    Process {
        id: previewProcess
        property string entryId: ""
        property int generation: 0
        property bool finished: false
        stdout: StdioCollector { id: previewOutput }
        onExited: (code, status) => {
            finished = true;
            // A slow decode must not replace a newer selection or a reopened view.
            if (!history.active || generation !== history.generation || entryId !== history.selectedId) return;
            try {
                history.preview = history.readResponse(previewOutput.text, code || status);
            } catch (error) {
                history.previewError = "Preview unavailable";
                console.warn("Luna clipboard preview: " + error.message);
            }
        }
        onRunningChanged: if (!running) Qt.callLater(() => {
            if (!previewProcess.running && !previewProcess.finished && history.active)
                history.previewError = "Preview unavailable";
            history.loadPreview();
        })
    }
}
