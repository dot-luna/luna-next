pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

// Own the cancellable countdown. The window executes a command only after requested().
Rectangle {
    id: power

    required property string uiFont
    required property real textSize
    property string action: ""
    property double deadline: 0
    property int seconds: 5
    property bool committed: false
    property string failure: ""
    property real contentOffset: active ? 0 : 12
    readonly property bool active: action !== ""
    readonly property bool cancellable: active && (!committed || failure !== "")
    readonly property string verb: action === "reboot" ? "Rebooting" : action === "shutdown" ? "Shutting down" : "Logging out"
    signal requested(string action)
    signal cancelled()

    color: "black"
    visible: active || opacity > 0
    enabled: active
    opacity: active ? 1 : 0
    Behavior on opacity { NumberAnimation { duration: 220; easing.type: Easing.OutCubic } }
    Behavior on contentOffset { NumberAnimation { duration: 260; easing.type: Easing.OutCubic } }

    // Repeated activation cannot restart or dispatch the same request twice.
    function begin(request) {
        if (active || !["logout", "reboot", "shutdown"].includes(request)) return;
        seconds = 5;
        failure = "";
        committed = false;
        deadline = Date.now() + 5000;
        action = request;
        forceActiveFocus();
        if (request === "logout") {
            committed = true;
            requested(action);
        }
    }

    function cancel() {
        if (!active) return true;
        if (!cancellable) return false;
        action = "";
        cancelled();
        return true;
    }

    function updateCountdown(now) {
        if (!active || committed) return;
        // A deadline avoids adding extra seconds when rendering or timer delivery stalls.
        seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
        if (seconds === 0) {
            committed = true;
            requested(action);
        }
    }

    Keys.onPressed: event => {
        if (event.key === Qt.Key_Escape) cancel();
        event.accepted = true;
    }
    Timer {
        interval: 50
        repeat: true
        running: power.active && !power.committed
        onTriggered: power.updateCountdown(Date.now())
    }
    MouseArea { anchors.fill: parent; acceptedButtons: Qt.AllButtons }
    Item {
        anchors.fill: parent
        transform: Translate { y: power.contentOffset }
        ColumnLayout {
            anchors.centerIn: parent
            width: Math.max(0, parent.width - 48)
            spacing: 24
            Label {
                objectName: "powerMessage"
                Layout.fillWidth: true
                horizontalAlignment: Text.AlignHCenter
                wrapMode: Text.WordWrap
                text: power.failure || (power.committed ? power.verb + "…"
                    : power.verb + " in " + power.seconds + (power.seconds === 1 ? " second…" : " seconds…"))
                textFormat: Text.PlainText
                color: "white"
                font.family: power.uiFont
                font.pointSize: power.textSize + 12
                font.weight: Font.Medium
                Accessible.role: Accessible.AlertMessage
                Accessible.name: text
            }
            Button {
                id: cancelButton
                objectName: "cancelPower"
                Layout.alignment: Qt.AlignHCenter
                visible: power.cancellable
                text: "Cancel · Esc"
                Accessible.name: "Cancel"
                focusPolicy: Qt.NoFocus
                leftPadding: 18
                rightPadding: 18
                topPadding: 10
                bottomPadding: 10
                background: Rectangle {
                    color: cancelButton.hovered ? "#282828" : "#171717"
                    radius: height / 2
                }
                contentItem: Label {
                    text: cancelButton.text
                    color: "#b0b0b0"
                    font.family: power.uiFont
                    font.pointSize: power.textSize
                }
                onClicked: power.cancel()
            }
        }
    }
}
