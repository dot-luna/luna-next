pragma ComponentBehavior: Bound

import QtQuick

// Shared countdown state keeps every lock output in sync; only the native adapter executes actions.
QtObject {
    id: actions
    property bool secure: false
    property bool authenticationBusy: false
    property int shutdownDelay: 3
    property var supportedActions: []
    property bool shutdownActive: false
    property bool committed: false
    property int remainingSeconds: 0
    property double deadline: 0
    property string errorMessage: ""
    property bool busy: false
    signal dispatchRequested(string action)

    function requestAction(action) {
        if (!secure || authenticationBusy || busy || shutdownActive || supportedActions.indexOf(action) < 0)
            return false;
        errorMessage = "";
        if (action === "powerOff") {
            remainingSeconds = shutdownDelay;
            deadline = Date.now() + shutdownDelay * 1000;
            committed = false;
            shutdownActive = true;
            if (shutdownDelay === 0)
                dispatch(action);
        } else {
            dispatch(action);
        }
        return true;
    }

    function cancelShutdown() {
        if (!shutdownActive || committed)
            return false;
        shutdownActive = false;
        return true;
    }

    function dispatch(action) {
        if (busy)
            return;
        if (action === "powerOff")
            committed = true;
        dispatchRequested(action);
    }

    onSecureChanged: {
        if (!secure && !committed)
            cancelShutdown();
    }

    property Timer countdown: Timer {
        interval: 100
        repeat: true
        running: actions.shutdownActive && !actions.committed
        onTriggered: {
            actions.remainingSeconds = Math.max(0, Math.ceil((actions.deadline - Date.now()) / 1000));
            if (actions.remainingSeconds === 0)
                actions.dispatch("powerOff");
        }
    }
}
