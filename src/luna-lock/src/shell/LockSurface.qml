pragma ComponentBehavior: Bound

import QtQuick
import Quickshell.Wayland

WlSessionLockSurface {
    id: surface

    required property var theme
    required property date dateTime
    required property var authentication
    required property var actions
    property string username: ""
    property url userIcon
    property bool keyboardActive: false
    signal activity
    signal activated(string screenName)

    color: theme.colors.background

    LockView {
        id: view
        objectName: "lock-view"
        anchors.fill: parent
        theme: surface.theme
        actions: surface.actions
        username: surface.username
        userIcon: surface.userIcon
        dateTime: surface.dateTime
        prompt: surface.authentication.message.trim() || "Password"
        statusText: surface.authentication.statusText
        responseRequired: surface.authentication.secure && surface.authentication.responseRequired
        responseVisible: surface.authentication.responseVisible
        busy: surface.authentication.busy
        canRetry: surface.authentication.canRetry
        keyboardActive: surface.keyboardActive
        onSubmitted: response => surface.authentication.submit(response)
        onRetryRequested: surface.authentication.begin()
        onActivity: {
            surface.activated(surface.screen?.name || "");
            surface.activity();
        }
    }

    Connections {
        target: surface.authentication
        function onClearInput() {
            view.clearInput();
        }
    }
}
