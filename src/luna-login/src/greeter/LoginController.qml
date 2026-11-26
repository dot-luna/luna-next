import QtQuick
import QtQml.Models

// Screens use this interface; SDDM owns authentication and system power policy.
QtObject {
    id: login

    property var backend: null
    property var users: null
    property var sessions: null
    property var keyboardState: null
    property var preferredUser: null
    property bool disconnected: false
    property bool busy: false
    property bool authenticated: false
    property string errorMessage: ""
    property string selectedUser: preferredUser !== null ? preferredUser : firstUser()
    readonly property int selectedUserIndex: userIndex(selectedUser)
    readonly property string selectedUserIcon: userIcon()
    readonly property int selectedSession: hyprlandSession()
    // systemd reserves tty6 for an on-demand console login by default.
    readonly property string consoleShortcut: "Ctrl+Alt+F6"
    readonly property bool capsLock: keyboardState ? keyboardState.capsLock === true : false
    readonly property bool canChangeLayout: keyboardState !== null && keyboardState.enabled === true
    readonly property var keyboardLayouts: canChangeLayout ? keyboardState.layouts : []
    readonly property int currentLayout: canChangeLayout ? keyboardState.currentLayout : -1
    readonly property bool available: backend !== null && !disconnected
    readonly property bool canPowerOff: available && backend.canPowerOff === true
    readonly property bool canReboot: available && backend.canReboot === true
    readonly property bool canSuspend: available && backend.canSuspend === true
    readonly property bool canHibernate: available && backend.canHibernate === true
    readonly property bool canHybridSleep: available && backend.canHybridSleep === true
    readonly property var supportedActions: {
        const actions = [];
        if (canPowerOff) actions.push("powerOff");
        if (canReboot) actions.push("reboot");
        if (canSuspend) actions.push("suspend");
        if (canHibernate) actions.push("hibernate");
        if (canHybridSleep) actions.push("hybridSleep");
        return actions;
    }
    signal authenticationFailed
    signal authenticationSucceeded

    // Instantiator reads native QAbstractListModel roles without visual controls.
    component UserRow: QtObject {
        required property string name
        required property string icon
    }
    component SessionRow: QtObject {
        required property string file
    }
    property Instantiator userRows: Instantiator {
        model: login.users
        delegate: UserRow {}
    }
    property Instantiator sessionRows: Instantiator {
        model: login.sessions
        delegate: SessionRow {}
    }

    function firstUser() {
        const first = userRows && userRows.count > 0 ? userRows.objectAt(0) as UserRow : null;
        return first ? first.name : "";
    }

    function userIndex(username) {
        for (let i = 0; userRows && i < userRows.count; ++i) {
            const user = userRows.objectAt(i) as UserRow;
            if (user && user.name === username) return i;
        }
        return -1;
    }

    function userIcon() {
        const user = userRows && selectedUserIndex >= 0 ? userRows.objectAt(selectedUserIndex) as UserRow : null;
        return user ? user.icon : "";
    }

    function selectUser(index) {
        if (busy || !Number.isInteger(index) || index < 0 || index >= userRows.count) return false;
        const user = userRows.objectAt(index) as UserRow;
        if (!user) return false;
        selectedUser = user.name;
        return true;
    }

    function hyprlandSession() {
        let uwsm = -1;
        for (let i = 0; sessionRows && i < sessionRows.count; ++i) {
            const session = sessionRows.objectAt(i) as SessionRow;
            if (!session) continue;
            // SDDM versions expose either a filename or an absolute desktop-file path.
            const file = session.file.slice(session.file.lastIndexOf("/") + 1).toLowerCase();
            if (file === "hyprland.desktop") return i;
            if (file === "hyprland-uwsm.desktop") uwsm = i;
        }
        return uwsm;
    }

    function clearError() {
        errorMessage = "";
    }

    function selectLayout(index) {
        if (!busy && canChangeLayout && Number.isInteger(index) && index >= 0 && index < keyboardLayouts.length)
            keyboardState.currentLayout = index;
    }

    // Passwords go directly to SDDM and are never retained as controller properties.
    // The session is fixed to Hyprland, regardless of extra arguments from a screen.
    function submit(username, password) {
        if (busy) return false;
        clearError();
        if (typeof username !== "string" || !username.trim()) {
            errorMessage = qsTr("Enter your username.");
            return false;
        }
        if (!available) {
            errorMessage = qsTr("The login service is unavailable.");
            return false;
        }
        if (selectedSession < 0) {
            errorMessage = qsTr("Hyprland is unavailable. Press %1 for console login.").arg(consoleShortcut);
            return false;
        }
        selectedUser = username.trim();
        authenticated = false;
        busy = true;
        backend.login(selectedUser, password, selectedSession);
        return true;
    }

    // Supported actions still respect SDDM's policy; a busy login blocks requests.
    function requestAction(action) {
        if (busy || supportedActions.indexOf(action) < 0) return false;
        backend[action]();
        return true;
    }
    function powerOff() { return requestAction("powerOff"); }
    function reboot() { return requestAction("reboot"); }
    function suspend() { return requestAction("suspend"); }
    function hibernate() { return requestAction("hibernate"); }
    function hybridSleep() { return requestAction("hybridSleep"); }

    onBackendChanged: disconnected = false

    property Connections backendSignals: Connections {
        target: login.backend
        function onLoginFailed() {
            login.authenticated = false;
            login.busy = false;
            login.errorMessage = qsTr("Login failed. Please try again.");
            login.authenticationFailed();
        }
        function onLoginSucceeded() {
            // SDDM replaces the greeter after success; keep input disabled until then.
            login.clearError();
            login.authenticated = true;
            login.authenticationSucceeded();
        }
        function onInformationMessage(message) {
            login.errorMessage = message;
        }
        function onSocketDisconnected() {
            if (login.authenticated) return;
            login.disconnected = true;
            login.busy = false;
            login.errorMessage = qsTr("Login service disconnected. Press %1 for console login.").arg(login.consoleShortcut);
            login.authenticationFailed();
        }
    }
}
