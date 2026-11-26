pragma ComponentBehavior: Bound

import QtQuick
import Quickshell.Io

// One controller serves every output. Power actions never release the session lock.
PowerActions {
    id: actions
    busy: request.running
    readonly property var methods: ({
            suspend: "Suspend",
            hibernate: "Hibernate",
            hybridSleep: "HybridSleep",
            reboot: "Reboot",
            powerOff: "PowerOff"
        })
    readonly property var busCommand: ["busctl", "--system", "--timeout=5", "--json=short", "call", "org.freedesktop.login1", "/org/freedesktop/login1", "org.freedesktop.login1.Manager"]
    property int capabilityIndex: 0
    readonly property var names: Object.keys(methods)

    function probeNext() {
        if (capabilityIndex >= names.length)
            return;
        probe.command = busCommand.concat(["Can" + methods[names[capabilityIndex]]]);
        probe.running = true;
    }

    property Process probe: Process {
        stdout: StdioCollector {
            id: capabilities
        }
        onExited: (code, status) => {
            if (code === 0) {
                try {
                    // "challenge" requires authentication, which this screen cannot present separately.
                    if (JSON.parse(capabilities.text).data?.[0] === "yes")
                        actions.supportedActions = actions.supportedActions.concat([actions.names[actions.capabilityIndex]]);
                } catch (error) {
                    console.warn("Luna lock power capabilities: " + error.message);
                }
            }
            actions.capabilityIndex++;
            actions.probeNext();
        }
    }
    property Process request: Process {
        stderr: StdioCollector {
            id: failure
        }
        onExited: (code, status) => {
            if (code !== 0) {
                actions.errorMessage = qsTr("Power action failed.");
                console.warn("Luna lock power action: " + failure.text);
                actions.shutdownActive = false;
                actions.committed = false;
            }
        }
    }

    onDispatchRequested: action => {
        // Do not open a separate authorization dialog behind the secure lock surface.
        request.command = busCommand.concat([methods[action], "b", "false"]);
        request.running = true;
    }

    Component.onCompleted: probeNext()
}
