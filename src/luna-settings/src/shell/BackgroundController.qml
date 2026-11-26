import QtQuick
import Quickshell.Io

// Serialize API requests and publish only confirmed library snapshots to the gallery.
Process {
    id: controller
    required property var bridgeCommand
    property var entries: []
    property bool busy: false
    property string errorMessage: ""
    property string operation: ""
    property bool completed: false
    signal finished(string action, bool success)

    function run(action, value) {
        if (busy) return;
        busy = true;
        completed = false;
        errorMessage = "";
        operation = action;
        exec(bridgeCommand.concat([action, value || ""]));
    }
    function fail(message) {
        errorMessage = message;
        busy = false;
        finished(operation, false);
    }
    stdout: StdioCollector { id: output }
    stderr: StdioCollector { id: diagnostics }
    onExited: (code, status) => {
        completed = true;
        if (code !== 0 || status !== 0) {
            fail(diagnostics.text.trim() || "Background action failed.");
            return;
        }
        try {
            const response = JSON.parse(output.text);
            if (!response.succes) { fail(response.errMessage); return; }
            entries = response.data;
            busy = false;
            finished(operation, true);
        } catch (error) {
            fail("Could not read backgrounds: " + error.message);
        }
    }
    onRunningChanged: if (!running) Qt.callLater(() => {
        if (!controller.running && !controller.completed && controller.busy) {
            controller.completed = true;
            controller.fail("Could not start the background service.");
        }
    })
    Component.onCompleted: run("list")
}
