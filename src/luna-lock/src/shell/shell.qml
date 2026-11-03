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
    property bool idleArmed: false
    property bool lockRequested: false
    property bool stopping: false
    property string focusedScreen: ""
    readonly property int idleSeconds: configuration?.idle_seconds ?? 600
    readonly property int dpmsSeconds: configuration?.dpms_seconds ?? 30

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
            configuration = nextConfiguration;
            theme = nextTheme;
            idleArmed = !stopping;
            return "ok";
        } catch (error) {
            console.warn("Luna lock snapshot: " + error.message);
            return "error: " + error.message;
        }
    }

    function lock() {
        if (stopping)
            return "refused";
        if (lockRequested || sessionLock.locked || sessionLock.secure)
            return "ok";
        focusedScreen = Hyprland.focusedMonitor?.name || Quickshell.screens[0]?.name || "";
        lockRequested = true;
        sessionLock.locked = true;
        return "ok";
    }

    function maybeQuit() {
        if (stopping && displayPower.settled) {
            // Bindings may briefly settle while the queued wake starts. Check
            // again after that transition before allowing the process to exit.
            Qt.callLater(() => {
                if (stopping && displayPower.settled)
                    Qt.quit();
            });
        }
    }

    function stop() {
        // Destruction of a secure Wayland lock leaves the compositor locked.
        // Refuse before disarming anything, including during acquisition.
        if (lockRequested || sessionLock.locked || sessionLock.secure)
            return "refused";
        stopping = true;
        idleArmed = false;
        idleRequest.running = false;
        displayPower.setOff(false);
        maybeQuit();
        return "ok";
    }

    IdleMonitor {
        id: autoLockIdle
        enabled: shell.idleArmed && !shell.stopping && !shell.lockRequested && !sessionLock.locked
            && !sessionLock.secure && shell.idleSeconds > 0
        timeout: shell.idleSeconds
        respectInhibitors: true
        onIsIdleChanged: {
            if (isIdle)
                idleRequest.running = true;
            else
                idleRequest.running = false;
        }
    }

    Process {
        id: idleRequest
        command: shell.apiCommand.concat(["lock-idle"])
        stderr: StdioCollector { id: idleError }
        onExited: (code, status) => {
            if (code !== 0 && autoLockIdle.isIdle)
                console.warn("Luna lock idle request failed: " + idleError.text);
        }
    }

    // A locked session must sleep its displays even when a media client holds
    // an idle inhibitor. Input wakes the outputs without releasing the lock.
    IdleMonitor {
        id: displayIdle
        enabled: shell.idleArmed && sessionLock.secure && shell.dpmsSeconds > 0
        timeout: shell.dpmsSeconds
        respectInhibitors: false
        onIsIdleChanged: displayPower.setOff(enabled && isIdle)
        onEnabledChanged: if (!enabled) displayPower.setOff(false)
    }

    DisplayPower {
        id: displayPower
        apiCommand: shell.apiCommand
        onSettledChanged: shell.maybeQuit()
    }

    Authenticator {
        id: authContext
        secure: sessionLock.secure
        onAuthenticated: {
            displayPower.setOff(false);
            sessionLock.locked = false;
            // Quickshell may release without notifying lockedChanged. Publish
            // our request state after release to rearm dependent idle bindings.
            shell.lockRequested = false;
        }
    }

    SystemClock {
        id: clock
        precision: SystemClock.Minutes
    }

    WlSessionLock {
        id: sessionLock
        onLockedChanged: {
            if (!locked && !secure)
                shell.lockRequested = false;
        }
        onSecureChanged: {
            if (!secure && !locked)
                shell.lockRequested = false;
        }

        LockSurface {
            theme: shell.theme
            dateTime: clock.date
            authentication: authContext
            keyboardActive: screen?.name === shell.focusedScreen
            onActivated: screenName => shell.focusedScreen = screenName
            onActivity: displayPower.setOff(false)
        }
    }

    IpcHandler {
        target: "lock"
        function status(): string {
            return sessionLock.secure ? "locked"
                : shell.lockRequested || sessionLock.locked ? "locking" : "idle";
        }
        function lock(): string { return shell.lock(); }
        function lockIdle(): string {
            // The API may finish after the idle user has already resumed.
            return autoLockIdle.enabled && autoLockIdle.isIdle ? shell.lock() : "ok";
        }
        function canPowerOff(): bool {
            return sessionLock.secure && displayIdle.enabled && displayIdle.isIdle;
        }
        function reload(settings: string, theme: string): string { return shell.reload(settings, theme); }
        function snapshot(): string { return JSON.stringify(shell.configuration); }
        function stop(): string { return shell.stop(); }
    }

    Component.onCompleted: {
        Quickshell.watchFiles = false;
        try {
            const command = JSON.parse(Quickshell.env("LUNA_LOCK_COMMAND"));
            if (!Array.isArray(command) || command.length === 0
                    || command.some(part => typeof part !== "string" || part === ""))
                throw new Error("missing API command");
            apiCommand = command;
            const result = reload(Quickshell.env("LUNA_LOCK_SETTINGS"), Quickshell.env("LUNA_LOCK_THEME"));
            if (result !== "ok")
                throw new Error(result);
        } catch (error) {
            console.error("Luna lock startup: " + error.message + ". Start with luna lock start.");
            Qt.callLater(() => Qt.exit(1));
        }
    }
}
