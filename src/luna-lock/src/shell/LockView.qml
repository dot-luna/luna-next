pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Item {
    id: view

    required property var theme
    required property date dateTime
    property string prompt: "Password"
    property string statusText: ""
    property bool responseRequired: false
    property bool responseVisible: false
    property bool busy: false
    property bool canRetry: false
    property bool keyboardActive: false
    signal submitted(string response)
    signal retryRequested()
    signal activity()

    function clearInput() {
        password.clear();
    }

    function activate() {
        if (keyboardActive && responseRequired)
            password.forceActiveFocus();
    }

    function submit() {
        if (responseRequired) {
            const response = password.text;
            password.clear();
            submitted(response);
        } else if (canRetry) {
            retryRequested();
        }
    }

    onKeyboardActiveChanged: activate()
    onResponseRequiredChanged: {
        if (!responseRequired)
            clearInput();
        activate();
    }
    Component.onCompleted: activate()

    Keys.onPressed: event => {
        activity();
        if (event.key === Qt.Key_Escape) {
            clearInput();
            event.accepted = true;
        }
    }

    MouseArea {
        anchors.fill: parent
        acceptedButtons: Qt.AllButtons
        hoverEnabled: true
        onPressed: mouse => {
            view.activity();
            view.activate();
            mouse.accepted = false;
        }
        onPositionChanged: view.activity()
        onWheel: wheel => {
            view.activity();
            wheel.accepted = true;
        }
    }

    ColumnLayout {
        anchors.centerIn: parent
        width: Math.min(320, Math.max(160, parent.width - 48))
        spacing: 16

        Text {
            objectName: "lock-clock"
            Layout.alignment: Qt.AlignHCenter
            text: Qt.formatTime(view.dateTime, Qt.locale().timeFormat(Locale.ShortFormat))
            color: view.theme.colors.bright_foreground
            font.family: view.theme.fonts.ui
            font.pixelSize: Math.min(80, view.width / 8)
            font.weight: Font.Light
        }

        Text {
            objectName: "lock-date"
            Layout.alignment: Qt.AlignHCenter
            Layout.bottomMargin: 24
            text: Qt.formatDate(view.dateTime, "dddd, d MMMM")
            color: view.theme.colors.foreground
            font.family: view.theme.fonts.ui
            font.pixelSize: 16
        }

        TextField {
            id: password
            objectName: "lock-password"
            Layout.fillWidth: true
            enabled: view.responseRequired
            placeholderText: view.prompt || "Password"
            echoMode: view.responseVisible ? TextInput.Normal : TextInput.Password
            inputMethodHints: Qt.ImhSensitiveData | Qt.ImhNoPredictiveText | Qt.ImhNoAutoUppercase
            selectByMouse: true
            color: view.theme.colors.foreground
            placeholderTextColor: Qt.alpha(view.theme.colors.foreground, 0.6)
            selectionColor: view.theme.colors.accent
            selectedTextColor: view.theme.colors.background
            font.family: view.theme.fonts.ui
            font.pixelSize: 16
            leftPadding: 14
            rightPadding: 14
            topPadding: 12
            bottomPadding: 12
            onAccepted: view.submit()
            onTextEdited: view.activity()
            Keys.onPressed: event => {
                view.activity();
                if (event.key === Qt.Key_Escape) {
                    clear();
                    event.accepted = true;
                }
            }
            background: Rectangle {
                color: Qt.alpha(view.theme.colors.foreground, 0.05)
                radius: 8
                border.width: 1
                border.color: password.activeFocus ? view.theme.colors.accent
                    : Qt.alpha(view.theme.colors.foreground, 0.2)
            }
            Accessible.name: view.prompt || "Password"
        }

        Button {
            id: submitButton
            objectName: "lock-submit"
            Layout.fillWidth: true
            text: view.canRetry ? "Retry" : "Unlock"
            enabled: view.responseRequired || view.canRetry
            onClicked: { view.activity(); view.submit(); }
            contentItem: Text {
                text: submitButton.text
                color: view.theme.colors.background
                font.family: view.theme.fonts.ui
                font.pixelSize: 15
                horizontalAlignment: Text.AlignHCenter
                verticalAlignment: Text.AlignVCenter
            }
            background: Rectangle {
                implicitHeight: 42
                radius: 8
                color: view.theme.colors.accent
                opacity: submitButton.enabled ? 1 : 0.45
            }
        }

        Text {
            objectName: "lock-status"
            Layout.fillWidth: true
            Layout.minimumHeight: 20
            text: view.busy ? "Authenticating…" : view.statusText
            color: view.theme.colors.foreground
            font.family: view.theme.fonts.ui
            font.pixelSize: 14
            horizontalAlignment: Text.AlignHCenter
            wrapMode: Text.Wrap
        }
    }
}
