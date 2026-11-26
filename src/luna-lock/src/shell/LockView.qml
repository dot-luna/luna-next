pragma ComponentBehavior: Bound

import QtQuick
import "screens/default" as Screens

// The compositor/PAM adapter owns authentication. Screens receive only this UI contract.
FocusScope {
    id: view

    required property var theme
    required property date dateTime
    property string username: ""
    property url userIcon
    property string prompt: "Password"
    property string statusText: ""
    property bool responseRequired: false
    property bool responseVisible: false
    property bool busy: false
    property bool canRetry: false
    property bool keyboardActive: false
    property var actions: null
    readonly property var supportedActions: actions?.supportedActions ?? []
    readonly property url screenPath: theme.screen?.path || ""
    signal submitted(string response)
    signal retryRequested
    signal activity
    signal inputCleared
    signal focusRequested

    function clearInput() {
        inputCleared();
    }

    function activate() {
        if (keyboardActive)
            focusRequested();
    }

    function loadScreen() {
        clearInput();
        if (screenPath.toString() !== "")
            screenLoader.setSource(screenPath, {
                lock: view
            });
        else
            useDefaultScreen();
    }

    function useDefaultScreen() {
        screenLoader.source = "";
        screenLoader.sourceComponent = defaultScreen;
    }

    onScreenPathChanged: loadScreen()
    onKeyboardActiveChanged: {
        if (!keyboardActive)
            clearInput();
        activate();
    }
    onResponseRequiredChanged: {
        if (!responseRequired)
            clearInput();
        activate();
    }
    onBusyChanged: activate()

    Loader {
        id: screenLoader
        anchors.fill: parent
        onLoaded: view.activate()
        onStatusChanged: {
            if (status === Loader.Error) {
                // A broken custom screen must leave a usable unlock form on the secure surface.
                if (source.toString() !== "") {
                    console.warn("Luna lock screen failed; using the default screen.");
                    view.useDefaultScreen();
                }
            }
        }
    }

    Component {
        id: defaultScreen
        Screens.Screen {
            lock: view
        }
    }

    Component.onCompleted: loadScreen()
}
