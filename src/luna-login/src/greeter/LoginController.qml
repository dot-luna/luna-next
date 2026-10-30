import QtQuick

// Screens call this controller; SDDM retains authentication and power policy.
QtObject {
    id: login

    property var backend: null
    property var users: null
    property var sessions: null
    property var keyboardState: null
    property string selectedUser: users && users.lastUser ? users.lastUser : ""
    property int selectedSession: sessions ? sessions.lastIndex : -1
    property bool busy: false
    property string errorMessage: ""
    readonly property bool capsLock: keyboardState ? keyboardState.capsLock : false
    readonly property bool canPowerOff: backend ? backend.canPowerOff : false
    readonly property bool canReboot: backend ? backend.canReboot : false
    readonly property bool canSuspend: backend ? backend.canSuspend : false
    readonly property bool canHibernate: backend ? backend.canHibernate : false
    signal authenticationFailed
    signal authenticationSucceeded

    function clearError() {
        errorMessage = "";
    }

    // Return true only when an attempt was submitted. Passwords are passed
    // directly to its proxy and are never retained as controller properties.
    function submit(username, password, sessionIndex) {
        if (busy)
            return false;
        clearError();
        if (!username.trim()) {
            errorMessage = qsTr("Enter your username.");
            return false;
        }
        if (sessionIndex < 0) {
            errorMessage = qsTr("Select a desktop session.");
            return false;
        }
        if (!backend) {
            errorMessage = qsTr("The login service is unavailable.");
            return false;
        }
        selectedUser = username.trim();
        selectedSession = sessionIndex;
        busy = true;
        backend.login(selectedUser, password, selectedSession);
        return true;
    }

    function powerOff() {
        if (!busy && canPowerOff)
            backend.powerOff();
    }
    function reboot() {
        if (!busy && canReboot)
            backend.reboot();
    }
    function suspend() {
        if (!busy && canSuspend)
            backend.suspend();
    }
    function hibernate() {
        if (!busy && canHibernate)
            backend.hibernate();
    }

    property Connections backendSignals: Connections {
        target: login.backend
        function onLoginFailed() {
            login.busy = false;
            login.errorMessage = qsTr("Login failed. Please try again.");
            login.authenticationFailed();
        }
        function onLoginSucceeded() {
            // Keep controls disabled until SDDM replaces the greeter session.
            login.clearError();
            login.authenticationSucceeded();
        }
    }
}
