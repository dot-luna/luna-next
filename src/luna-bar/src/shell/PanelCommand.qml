import QtQuick
import Quickshell.Io

// Serialize a short command and surface failure to the panel, including failure to start.
Process {
    id: process
    property bool completed: false
    signal succeeded(string output)
    signal failed(string message)
    function run(args) {
        if (running) return;
        completed = false;
        exec(args);
    }
    stdout: StdioCollector { id: output }
    stderr: StdioCollector { id: diagnostics }
    onExited: (code, status) => {
        completed = true;
        if (code === 0 && status === 0) succeeded(output.text.trim());
        else failed(diagnostics.text.trim() || "Command failed");
    }
    onRunningChanged: if (!running) Qt.callLater(() => {
        if (!process.running && !process.completed) {
            process.completed = true;
            process.failed("Command could not start");
        }
    })
}
