pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import Quickshell.Wayland

ShellRoot {
    id: shell

    property var configuration: null
    property var theme: null
    property var apiCommand: []
    property bool showing: false
    property bool idleArmed: false
    property string focusedScreen: ""
    readonly property int idleSeconds: configuration?.idle_seconds ?? 300

    // JSONC parsing and settings validation belong to the API. The renderer only
    // decodes its trusted transport snapshots and publishes them together.
    function parseObject(snapshot) {
        const value = JSON.parse(snapshot);
        if (!value || typeof value !== "object" || Array.isArray(value))
            throw new Error("expected a JSON object");
        return value;
    }

    function reload(settingsSnapshot, themeSnapshot) {
        try {
            const nextConfiguration = parseObject(settingsSnapshot);
            const nextTheme = parseObject(themeSnapshot);
            idleArmed = false;
            hide();
            configuration = nextConfiguration;
            theme = nextTheme;
            idleArmed = true;
            return "ok";
        } catch (error) {
            console.warn("Luna screensaver snapshot: " + error.message);
            return "error: " + error.message;
        }
    }

    function show() {
        focusedScreen = Hyprland.focusedMonitor?.name || Quickshell.screens[0]?.name || "";
        showing = true;
    }

    function hide() {
        idleRequest.running = false;
        showing = false;
    }

    IdleMonitor {
        id: saverIdle
        enabled: shell.idleArmed && shell.idleSeconds > 0
        timeout: shell.idleSeconds
        respectInhibitors: true
        onIsIdleChanged: {
            if (isIdle)
                idleRequest.running = true;
            else
                shell.hide();
        }
    }

    Process {
        id: idleRequest
        command: shell.apiCommand.concat(["show-idle"])
        stderr: StdioCollector { id: idleError }
        onExited: (code, status) => {
            if (code !== 0 && saverIdle.isIdle)
                console.warn("Luna screensaver idle request failed: " + idleError.text);
        }
    }

    SystemClock {
        id: clock
        precision: SystemClock.Minutes
    }

    Variants {
        id: surfaces
        model: shell.theme ? Quickshell.screens : []
        delegate: SaverSurface {
            required property var modelData
            screen: modelData
            theme: shell.theme
            dateTime: clock.date
            showing: shell.showing
            keyboardActive: modelData.name === shell.focusedScreen
            onDismissed: shell.hide()
        }
    }

    IpcHandler {
        target: "screensaver"
        function status(): string { return shell.showing ? "visible" : "hidden"; }
        function show(): void { shell.show(); }
        // Input may resume while the API is checking the lock state. A stale
        // idle request must not reopen a surface the user just dismissed.
        function showIdle(): void {
            if (saverIdle.enabled && saverIdle.isIdle)
                shell.show();
        }
        function hide(): void { shell.hide(); }
        function reload(settings: string, theme: string): string { return shell.reload(settings, theme); }
        function snapshot(): string { return JSON.stringify(shell.configuration); }
    }

    Component.onCompleted: {
        Quickshell.watchFiles = false;
        try {
            const command = JSON.parse(Quickshell.env("LUNA_SCREENSAVER_COMMAND"));
            if (!Array.isArray(command) || command.length === 0
                    || command.some(part => typeof part !== "string" || part === ""))
                throw new Error("missing API command");
            apiCommand = command;
            const result = reload(Quickshell.env("LUNA_SCREENSAVER_SETTINGS"),
                                  Quickshell.env("LUNA_SCREENSAVER_THEME"));
            if (result !== "ok")
                throw new Error(result);
        } catch (error) {
            console.error("Luna screensaver startup: " + error.message + ". Start with luna screensaver start.");
            Qt.callLater(() => Qt.exit(1));
        }
    }
}
