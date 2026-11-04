pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
// Registers structured ProcessContext conversion for execDetached(context).
import Quickshell.Io
import Quickshell.Wayland
import "Applications.js" as Applications
import "System.js" as System
import "Query.js" as Query

PanelWindow {
    id: panel

    required property var theme
    property bool opened: false
    readonly property alias content: menuContent
    property bool stayAwake: false
    signal dismissed()

    visible: opened
    color: "transparent"
    anchors { top: true; bottom: true; left: true; right: true }
    exclusionMode: ExclusionMode.Ignore
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.namespace: "luna-menu"
    WlrLayershell.keyboardFocus: visible ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None

    // Blur only the card, leaving the fullscreen dismissal surface clear.
    BackgroundEffect.blurRegion: panel.theme.appearance.blur.enabled && !powerScreen.active ? menuBlurRegion : null
    Region {
        id: menuBlurRegion
        item: menuContent
        radius: menuContent.radius
    }

    function show(section) {
        if (!powerScreen.cancel()) return;
        menuContent.reset(section);
        opened = true;
        focusDelay.restart();
    }

    function hide() {
        if (!powerScreen.cancel()) return;
        opened = false;
        focusDelay.stop();
    }

    onDismissed: hide()

    ApplicationInhibitor { id: applicationInhibitor }
    // Manual state stays separate: switching it off cannot release a video's request.
    StayAwake { id: awake; enabled: panel.stayAwake || applicationInhibitor.inhibited }

    Timer {
        id: focusDelay
        interval: 40
        onTriggered: if (panel.opened && !powerScreen.active) menuContent.focusSearch()
    }

    MouseArea {
        objectName: "dismissArea"
        anchors.fill: parent
        acceptedButtons: Qt.AllButtons
        onPressed: panel.dismissed()
    }

    MenuContent {
        id: menuContent
        objectName: "menuContent"
        anchors.centerIn: parent
        width: Math.max(0, Math.min(implicitWidth, panel.width - 2 * Math.max(16, panel.theme.appearance.gaps.outer)))
        height: Math.max(0, Math.min(implicitHeight, panel.height - 2 * Math.max(16, panel.theme.appearance.gaps.outer)))
        theme: panel.theme
        visible: !powerScreen.active
        applications: DesktopEntries.applications.values
        stayAwake: panel.stayAwake
        onDismissed: panel.dismissed()
        onApplicationActivated: entry => {
            if (Applications.launch(entry, context => Quickshell.execDetached(context)))
                panel.dismissed();
        }
        onQueryActivated: entry => {
            const command = Query.command(entry, Quickshell.env("SHELL"));
            if (command.length) {
                Quickshell.execDetached(command);
                panel.dismissed();
            }
        }
        onActionActivated: action => {
            if (action === "about") {
                Quickshell.execDetached(System.aboutCommand());
                panel.dismissed();
            } else if (action === "stay-awake") {
                const selected = menuContent.selectedIndex;
                panel.stayAwake = !panel.stayAwake;
                menuContent.jumpSelection(selected);
                menuContent.focusSearch();
            } else if (action === "screensaver" || action === "lock" || action.startsWith("screenshot-")) {
                panel.hide();
                // Yield to the event loop after hiding, before starting capture or a fullscreen app.
                Qt.callLater(() => applicationCommand.run(action));
            } else {
                focusDelay.stop();
                powerScreen.begin(action);
            }
        }
    }

    PowerScreen {
        id: powerScreen
        objectName: "powerScreen"
        anchors.fill: parent
        uiFont: menuContent.uiFont
        textSize: menuContent.textSize
        onCancelled: {
            if (menuContent.section === "system") menuContent.showSection("system");
            else menuContent.navigate("system");
            menuContent.focusSearch();
        }
        onRequested: action => sessionCommand.run(action)
    }

    Process {
        id: sessionCommand
        objectName: "sessionCommand"
        property bool finished: false
        function run(action) {
            finished = false;
            exec(System.command(action));
        }
        function fail() {
            powerScreen.failure = "Couldn’t " + (powerScreen.action === "reboot" ? "reboot"
                : powerScreen.action === "shutdown" ? "shut down" : "log out");
            console.error("Luna menu: " + powerScreen.failure + ": " + diagnostics.text.trim());
        }
        stderr: StdioCollector { id: diagnostics }
        onExited: (code, status) => {
            finished = true;
            if (code !== 0 || status !== 0) fail();
        }
        // Failed starts do not emit exited; let normal exits publish their status first.
        onRunningChanged: if (!running) Qt.callLater(() => {
            if (!sessionCommand.running && !sessionCommand.finished) {
                sessionCommand.finished = true;
                sessionCommand.fail();
            }
        })
    }

    Process {
        id: applicationCommand
        objectName: "applicationCommand"
        property bool finished: false
        property string action: ""
        function run(request) {
            action = request;
            finished = false;
            exec(System.command(request, Quickshell.env("HOME") + "/.local/bin/luna"));
        }
        function fail() {
            console.error("Luna menu: couldn’t open " + action + ": " + applicationDiagnostics.text.trim());
        }
        stderr: StdioCollector { id: applicationDiagnostics }
        onExited: (code, status) => {
            finished = true;
            if (code !== 0 || status !== 0) fail();
        }
        // A failed start has no exited signal; defer so normal exits finish first.
        onRunningChanged: if (!running) Qt.callLater(() => {
            if (!applicationCommand.running && !applicationCommand.finished) {
                applicationCommand.finished = true;
                applicationCommand.fail();
            }
        })
    }

    // A separate surface also dismisses clicks on an empty desktop on another output.
    Variants {
        model: Quickshell.screens
        delegate: PanelWindow {
            required property var modelData
            screen: modelData
            visible: panel.opened && modelData !== panel.screen
            color: powerScreen.active ? "black" : "transparent"
            Behavior on color { ColorAnimation { duration: 220; easing.type: Easing.OutCubic } }
            anchors { top: true; bottom: true; left: true; right: true }
            exclusionMode: ExclusionMode.Ignore
            WlrLayershell.layer: WlrLayer.Overlay
            WlrLayershell.namespace: "luna-menu-dismiss"
            WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
            MouseArea {
                anchors.fill: parent
                acceptedButtons: Qt.AllButtons
                onPressed: panel.dismissed()
            }
        }
    }
}
