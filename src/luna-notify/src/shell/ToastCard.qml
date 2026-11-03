pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import Quickshell
import Quickshell.Services.Notifications

Rectangle {
    id: card
    required property var notification
    required property var theme
    property bool keyboardMode: false
    signal releaseFocus()
    signal reveal(var item)
    readonly property var actions: notification.actions.filter(action => action.identifier !== "default")
    readonly property var defaultAction: notification.actions.find(action => action.identifier === "default") || null
    // The native timeout uses milliseconds; zero and critical alerts stay until closed.
    readonly property real duration: notification.urgency === NotificationUrgency.Critical || notification.expireTimeout === 0
        ? 0 : notification.expireTimeout < 0 ? 5000 : notification.expireTimeout
    property real remaining: duration
    property real lastTick: Date.now()
    readonly property string content: JSON.stringify([notification.summary, notification.body, notification.image,
        notification.appIcon, notification.expireTimeout, notification.urgency,
        notification.actions.map(action => [action.identifier, action.text])])

    function focusDismiss() { closeButton.forceActiveFocus(Qt.TabFocusReason); }
    function invoke(action) { action.invoke(); }
    function iconSource(value) {
        return value.startsWith("/") ? "file://" + value : value.includes(":") ? value : Quickshell.iconPath(value);
    }
    // Replacement signals can arrive before dependent bindings settle.
    onContentChanged: Qt.callLater(() => { remaining = duration; lastTick = Date.now(); })
    implicitHeight: body.implicitHeight + 28
    radius: Math.min(16, theme.appearance.rounding)
    color: theme.colors.background
    border.width: Math.max(1, theme.appearance.border_width)
    border.color: notification.urgency === NotificationUrgency.Critical ? theme.colors.accent : theme.colors.muted
    clip: true
    opacity: 0
    Component.onCompleted: entrance.start()
    NumberAnimation { id: entrance; target: card; property: "opacity"; to: 1; duration: 140; easing.type: Easing.OutCubic }

    HoverHandler { id: hover }
    Timer {
        interval: 50
        repeat: true
        running: card.remaining > 0
        onTriggered: {
            const now = Date.now();
            if (!hover.hovered && !card.keyboardMode)
                card.remaining = Math.max(0, card.remaining - (now - card.lastTick));
            card.lastTick = now;
            if (card.remaining === 0) card.notification.expire();
        }
    }
    Keys.onEscapePressed: card.releaseFocus()
    Keys.onDeletePressed: card.notification.dismiss()

    ColumnLayout {
        id: body
        anchors { left: parent.left; right: parent.right; top: parent.top; margins: 14 }
        spacing: 8
        RowLayout {
            Layout.fillWidth: true
            spacing: 10
            Image {
                visible: card.notification.appIcon !== ""
                source: visible ? card.iconSource(card.notification.appIcon) : ""
                Layout.preferredWidth: 24
                Layout.preferredHeight: 24
                sourceSize: Qt.size(24, 24)
                fillMode: Image.PreserveAspectFit
            }
            Label {
                Layout.fillWidth: true
                text: card.notification.appName
                textFormat: Text.PlainText
                elide: Text.ElideRight
                font { family: card.theme.fonts.ui; pixelSize: 12 }
                color: card.theme.colors.foreground
            }
            Button {
                id: closeButton
                objectName: "dismiss"
                implicitWidth: 28
                implicitHeight: 28
                Accessible.name: "Dismiss notification"
                focusPolicy: Qt.StrongFocus
                onClicked: card.notification.dismiss()
                onActiveFocusChanged: if (activeFocus) card.reveal(closeButton)
                Keys.onReturnPressed: click()
                Keys.onEnterPressed: click()
                background: Rectangle {
                    radius: 6
                    color: closeButton.hovered ? card.theme.colors.selection : "transparent"
                    border.width: closeButton.visualFocus ? 1 : 0
                    border.color: card.theme.colors.accent
                }
                contentItem: Icon { name: "cancel-01"; ink: card.theme.colors.foreground; implicitWidth: 14; implicitHeight: 14 }
            }
        }
        Button {
            id: contentButton
            objectName: "content"
            Layout.fillWidth: true
            padding: 0
            focusPolicy: card.defaultAction ? Qt.StrongFocus : Qt.NoFocus
            Accessible.name: card.notification.summary
            onClicked: if (card.defaultAction) card.invoke(card.defaultAction)
            onActiveFocusChanged: if (activeFocus) card.reveal(contentButton)
            Keys.onReturnPressed: click()
            Keys.onEnterPressed: click()
            background: Rectangle {
                color: "transparent"
                radius: 4
                border.width: contentButton.visualFocus ? 1 : 0
                border.color: card.theme.colors.accent
            }
            contentItem: ColumnLayout {
                spacing: 5
                Label {
                    Layout.fillWidth: true
                    text: card.notification.summary
                    textFormat: Text.PlainText
                    wrapMode: Text.Wrap
                    maximumLineCount: 2
                    elide: Text.ElideRight
                    color: card.theme.colors.bright_foreground
                    font { family: card.theme.fonts.ui; pixelSize: 14; weight: Font.DemiBold }
                }
                Label {
                    Layout.fillWidth: true
                    visible: text !== ""
                    text: card.notification.body
                    textFormat: Text.PlainText
                    wrapMode: Text.Wrap
                    maximumLineCount: 4
                    elide: Text.ElideRight
                    color: card.theme.colors.foreground
                    font { family: card.theme.fonts.ui; pixelSize: 13 }
                }
                Image {
                    visible: card.notification.image !== ""
                    source: visible ? card.notification.image : ""
                    Layout.fillWidth: true
                    Layout.preferredHeight: visible ? 100 : 0
                    fillMode: Image.PreserveAspectFit
                    sourceSize: Qt.size(352, 100)
                }
            }
        }
        Flow {
            Layout.fillWidth: true
            spacing: 6
            visible: card.actions.length > 0
            Repeater {
                model: card.actions
                delegate: Button {
                    id: actionButton
                    required property var modelData
                    text: modelData.text
                    width: Math.min(implicitWidth, card.width - 28)
                    focusPolicy: Qt.StrongFocus
                    onClicked: card.invoke(modelData)
                    onActiveFocusChanged: if (activeFocus) card.reveal(actionButton)
                    Keys.onReturnPressed: click()
                    Keys.onEnterPressed: click()
                    background: Rectangle {
                        radius: 6
                        color: actionButton.hovered ? card.theme.colors.selection : card.theme.colors.lighter_background
                        border.width: actionButton.visualFocus ? 1 : 0
                        border.color: card.theme.colors.accent
                    }
                    contentItem: Label {
                        text: actionButton.text
                        textFormat: Text.PlainText
                        elide: Text.ElideRight
                        color: card.theme.colors.foreground
                        font { family: card.theme.fonts.ui; pixelSize: 12 }
                    }
                }
            }
        }
    }
}
