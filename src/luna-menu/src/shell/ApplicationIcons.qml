pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Io

Scope {
    id: icons
    property var names: []
    property var sources: ({})
    readonly property string request: JSON.stringify(Array.from(new Set(names.filter(Boolean))))
    property bool pending: false

    function refresh() {
        pending = true;
        Qt.callLater(resolve);
    }

    function resolve() {
        if (!pending || lookup.running) return;
        pending = false;
        if (request === "[]") {
            sources = {};
            return;
        }
        lookup.input = request;
        lookup.stdinEnabled = true;
        lookup.running = true;
    }

    onRequestChanged: refresh()

    // Batch lookups off the UI thread. A queued refresh uses the latest request
    // after the current process exits, including when an install changes entries.
    Process {
        id: lookup
        property string input
        command: ["python3", decodeURIComponent(Qt.resolvedUrl("application_icons.py").toString().slice(7))]
        onStarted: {
            write(input);
            stdinEnabled = false;
        }
        stdout: StdioCollector { id: output }
        stderr: StdioCollector { id: diagnostics }
        onExited: (code, status) => {
            if (code !== 0 || status !== 0) {
                console.warn("Luna menu icon lookup failed: " + diagnostics.text.trim());
                return;
            }
            // A newer desktop-entry snapshot must win over an obsolete result.
            if (input !== icons.request) return;
            try {
                icons.sources = JSON.parse(output.text);
            } catch (error) {
                console.warn("Luna menu icon lookup: " + error.message);
            }
        }
        onRunningChanged: if (!running) Qt.callLater(icons.resolve)
    }
}
