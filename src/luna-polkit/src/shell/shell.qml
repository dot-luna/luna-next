pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Hyprland
import Quickshell.Services.Polkit

// Authentication owns its shell so reloading another app cannot dismiss a prompt.
ShellRoot {
    id: shell

    readonly property bool validating: Quickshell.env("LUNA_NEXT_POLKIT_VALIDATE") === "1"
    readonly property var agent: backend.item
    property var theme: null
    property var promptScreen: Quickshell.screens[0] || null

    function loadTheme() {
        const value = JSON.parse(Quickshell.env("LUNA_NEXT_POLKIT_THEME"));
        if (!value || typeof value !== "object" || !value.colors || !value.fonts || !value.appearance)
            throw new Error("expected colors, fonts, and appearance objects");
        const colors = ["background", "foreground", "bright_foreground", "muted", "accent",
            "accent_foreground", "selection", "selection_foreground", "lighter_background", "error"];
        for (const key of colors) {
            if (typeof value.colors[key] !== "string" || value.colors[key] === "")
                throw new Error("missing theme color: " + key);
        }
        if (typeof value.fonts.ui !== "string" || value.fonts.ui === "")
            throw new Error("missing theme UI font");
        for (const key of ["rounding", "border_width"]) {
            if (typeof value.appearance[key] !== "number" || !Number.isFinite(value.appearance[key]) || value.appearance[key] < 0)
                throw new Error("invalid theme appearance: " + key);
        }
        return value;
    }

    Loader {
        id: backend
        active: shell.theme !== null && !shell.validating
        sourceComponent: PolkitAgent {
            path: "/org/lunanext/Polkit"
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
            flow: shell.agent ? shell.agent.flow : null
            // Keep the prompt on its initial monitor; recover if it is unplugged.
            screen: Quickshell.screens.includes(shell.promptScreen) ? shell.promptScreen : Quickshell.screens[0] || null
        }
        onLoaded: {
            if (shell.validating) {
                // Load the real UI and imports before replacing a registered agent.
                Qt.callLater(() => {
                    console.info("Luna Next polkit validation passed");
                    Qt.quit();
                });
            }
        }
    }

    Timer {
        interval: 10000
        running: shell.theme !== null && !shell.validating && (!shell.agent || !shell.agent.isRegistered)
        onTriggered: {
            console.error("Luna Next authentication could not register. Check that this is a desktop session and no other polkit agent is running.");
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
            theme = loadTheme();
        } catch (error) {
            console.error("Luna Next polkit theme: " + error.message + ". Start the agent with lnxt polkit serve.");
            // Quickshell connects engine exit signals after component creation.
            Qt.callLater(() => Qt.exit(1));
        }
    }
}
