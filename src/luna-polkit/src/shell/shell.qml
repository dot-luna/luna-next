pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Hyprland
import Quickshell.Services.Polkit

// Authentication owns its shell so reloading another app cannot dismiss a prompt.
ShellRoot {
    id: shell

    readonly property bool validating: Quickshell.env("LUNA_POLKIT_VALIDATE") === "1"
    readonly property var agent: backend.item
    property var theme: null
    property var promptSettings: null
    property var promptScreen: Quickshell.screens[0] || null

    function loadTheme() {
        const value = JSON.parse(Quickshell.env("LUNA_POLKIT_THEME"));
        if (!value || !value.colors || !value.fonts || !value.appearance)
            throw new Error("missing validated theme snapshot");
        return value;
    }

    Loader {
        id: backend
        active: shell.theme !== null && !shell.validating
        sourceComponent: PolkitAgent {
            path: "/org/luna/Polkit"
            onAuthenticationRequestStarted: {
                const name = Hyprland.focusedMonitor ? Hyprland.focusedMonitor.name : "";
                shell.promptScreen = Quickshell.screens.find(screen => screen.name === name) || Quickshell.screens[0] || null;
            }
        }
    }

    Loader {
        active: shell.theme !== null
        sourceComponent: AuthDialog {
            theme: shell.theme
            settings: shell.promptSettings
            flow: shell.agent ? shell.agent.flow : null
            // Keep the prompt on its initial monitor; recover if it is unplugged.
            screen: Quickshell.screens.includes(shell.promptScreen) ? shell.promptScreen : Quickshell.screens[0] || null
        }
        onLoaded: {
            if (shell.validating) {
                // Load the real UI and imports before replacing a registered agent.
                Qt.callLater(() => {
                    console.info("Luna polkit validation passed");
                    Qt.quit();
                });
            }
        }
    }

    Timer {
        interval: 10000
        running: shell.theme !== null && !shell.validating && (!shell.agent || !shell.agent.isRegistered)
        onTriggered: {
            console.error("Luna authentication could not register. Check that this is a desktop session and no other polkit agent is running.");
            Qt.exit(1);
        }
    }

    IpcHandler {
        target: "polkit"
        function ping(): bool { return shell.agent !== null && shell.agent.isRegistered; }
        function status(): string { return shell.agent && shell.agent.isRegistered ? "running" : "unavailable"; }
        function stop(): void { Qt.quit(); }
    }

    Component.onCompleted: {
        // Source edits must not destroy a pending native authentication session.
        Quickshell.watchFiles = false;
        try {
            promptSettings = JSON.parse(Quickshell.env("LUNA_POLKIT_SETTINGS"));
            theme = loadTheme();
        } catch (error) {
            console.error("Luna polkit theme: " + error.message + ". Start the agent with luna polkit start.");
            // Quickshell connects engine exit signals after component creation.
            Qt.callLater(() => Qt.exit(1));
        }
    }
}
