pragma ComponentBehavior: Bound

import QtQuick
import Quickshell.Io

QtObject {
    id: power

    required property var apiCommand
    property string desired: "on"
    property string lastAttempt: "on"
    readonly property bool busy: request.running
    readonly property bool settled: !busy && desired === lastAttempt

    function setOff(off) {
        desired = off ? "off" : "on";
        drive();
    }

    function drive() {
        if (request.running || desired === lastAttempt)
            return;
        // Never cancel an off request: it may already have reached Hyprland.
        // Record each attempt and send the newest intent after it exits, so
        // resumed input always queues an on request behind an in-flight off.
        lastAttempt = desired;
        request.command = apiCommand.concat(["display", desired]);
        request.running = true;
    }

    property Process request: Process {
        stderr: StdioCollector { id: errorOutput }
        onExited: (code, status) => {
            if (code !== 0)
                console.warn("Luna lock display request failed: " + errorOutput.text);
            power.drive();
        }
    }
}
