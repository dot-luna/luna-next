pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Io

Scope {
    id: inhibitor
    property bool inhibited: false

    Process {
        id: bridge
        command: ["python3", decodeURIComponent(Qt.resolvedUrl("idle_inhibit.py").toString().slice(7))]
        running: true
        stdout: SplitParser {
            onRead: data => {
                try {
                    const state = JSON.parse(data);
                    if (typeof state.inhibited !== "boolean") throw new Error("expected inhibition state");
                    inhibitor.inhibited = state.inhibited;
                } catch (error) {
                    console.error("Luna idle inhibition: " + error.message);
                }
            }
        }
        stderr: SplitParser { onRead: data => console.warn(data) }
        onExited: {
            inhibitor.inhibited = false;
            console.warn("Luna idle inhibition bridge stopped; restart the menu to retry");
        }
    }
}
