pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import Quickshell
import Quickshell.Services.Notifications

Item {
    id: card
    required property var notification
    required property var theme
    required property var settings
    readonly property var style: settings.priority[notification.urgency === NotificationUrgency.Critical ? "critical"
        : notification.urgency === NotificationUrgency.Low ? "low" : "normal"]
    property bool keyboardMode: false
    property bool exposed: true
    signal reveal(var item)
    signal opened()
    // Whatly uses "open"; other senders use the standard default action.
    readonly property var openAction: notification.actions.find(action => action.identifier === "default")
        || notification.actions.find(action => action.identifier === "open") || null
    // Explicit sender timeouts win; only unspecified durations use Luna's priority defaults.
    readonly property real duration: notification.expireTimeout >= 0 ? notification.expireTimeout
        : notification.urgency === NotificationUrgency.Critical ? 0 : settings.timeout_ms
    property real remaining: duration
    property real lastTick: Date.now()
    readonly property string content: JSON.stringify([notification.appName, notification.desktopEntry, notification.resident, notification.transient,
        notification.summary, notification.body, notification.image,
        notification.appIcon, notification.expireTimeout, notification.urgency,
        notification.actions.map(action => [action.identifier, action.text])])

    function focusToast() { forceActiveFocus(Qt.TabFocusReason); }
    function open() {
        if (openAction) {
            const action = openAction;
            const current = notification;
            const resident = current.resident;
            opened();
            action.invoke();
            // Resident senders keep their notification after an action; this UI has no history.
            if (resident) current.dismiss();
            return;
        }
        // Never substitute another sender action: it could delete or reject something.
        const desktopId = notification.desktopEntry.replace(/\.desktop$/, "");
        const application = desktopId ? DesktopEntries.byId(desktopId) : null;
        if (application && !application.noDisplay && application.command.length) {
            opened();
            application.execute();
            notification.dismiss();
        }
    }
    function iconSource(value) {
        return value.startsWith("/") ? "file://" + value : value.includes(":") ? value : Quickshell.iconPath(value);
    }
    // Quickshell emits no event for an identical replacement; its remaining time is retained.
    onContentChanged: Qt.callLater(() => { remaining = duration; lastTick = Date.now(); })
    // Reserve the shadow inside the toast bounds so the stack viewport cannot crop it.
    readonly property int shadowPadding: settings.appearance.shadow_size > 0 ? settings.appearance.shadow_size + 2 : 0
    implicitHeight: Math.max(contentRow.implicitHeight, settings.appearance.avatar_size) + (settings.appearance.padding + shadowPadding) * 2
    activeFocusOnTab: exposed
    objectName: "toast-" + notification.id
    Accessible.role: Accessible.Button
    Accessible.name: notification.appName + ": " + notification.summary + ". " + notification.body
    Accessible.onPressAction: open()
    onActiveFocusChanged: if (activeFocus) reveal(card)
    property real entranceProgress: 0
    opacity: style.opacity * entranceProgress
    Component.onCompleted: entrance.start()
    NumberAnimation { id: entrance; target: card; property: "entranceProgress"; to: 1; duration: 130; easing.type: Easing.OutCubic }

    // Layered rectangles keep elevation visible with Qt's software renderer too.
    Repeater {
        model: card.settings.appearance.shadow_size
        delegate: Rectangle {
            required property int index
            objectName: "toastShadow"
            readonly property int spread: index + 1
            x: surface.x - spread
            y: surface.y - spread + 2
            width: surface.width + spread * 2
            height: surface.height + spread * 2
            radius: surface.radius + spread
            color: Qt.rgba(0, 0, 0, card.settings.appearance.shadow_opacity / card.settings.appearance.shadow_size)
            z: -1
        }
    }
    Rectangle {
        id: surface
        objectName: "toastSurface"
        anchors { fill: parent; margins: card.shadowPadding }
        radius: Math.min(12, card.theme.appearance.rounding)
        gradient: Gradient {
            GradientStop { position: 0; color: Qt.tint(card.theme.colors.background, "#09ffffff") }
            GradientStop { position: 1; color: card.theme.colors.background }
        }
        border.width: card.settings.appearance.border_width
        border.color: card.activeFocus ? card.theme.colors.accent : card.settings.appearance.border_color
        clip: true
        Rectangle {
            objectName: "priorityStrip"
            anchors { top: parent.top; bottom: parent.bottom; margins: surface.border.width }
            x: card.style.strip_side === "left" ? surface.border.width : surface.width - width - surface.border.width
            width: card.style.strip_width
            color: card.style.strip_color
            visible: width > 0
        }
    }

    HoverHandler { id: hover }
    Timer {
        interval: 50
        repeat: true
        running: card.remaining > 0
        onTriggered: {
            const now = Date.now();
            // Covered toasts have not been read yet; their countdown starts when exposed.
            if (card.exposed && !hover.hovered && !card.keyboardMode)
                card.remaining = Math.max(0, card.remaining - (now - card.lastTick));
            card.lastTick = now;
            if (card.remaining === 0) card.notification.expire();
        }
    }
    Keys.onReturnPressed: open()
    Keys.onEnterPressed: open()
    Keys.onSpacePressed: open()
    Keys.onEscapePressed: notification.dismiss()
    Keys.onDeletePressed: notification.dismiss()

    MouseArea {
        anchors.fill: parent
        acceptedButtons: Qt.LeftButton | Qt.RightButton
        onClicked: mouse => {
            if (mouse.button === Qt.RightButton) card.notification.dismiss();
            else card.open();
        }
    }
    RowLayout {
        id: contentRow
        anchors { left: parent.left; right: parent.right; top: parent.top; margins: card.settings.appearance.padding + card.shadowPadding }
        spacing: 10
        // image-data often contains a contact avatar, not a message attachment.
        Item {
            objectName: "avatar"
            clip: true
            Layout.alignment: Qt.AlignTop
            Layout.preferredWidth: card.settings.appearance.avatar_size
            Layout.preferredHeight: card.settings.appearance.avatar_size
            Image {
                objectName: "priorityIcon"
                anchors.centerIn: parent
                width: Math.min(22, parent.width)
                height: width
                source: card.style.icon_source
                sourceSize: Qt.size(44, 44)
                visible: contact.status !== Image.Ready && applicationIcon.status !== Image.Ready
            }
            Image {
                id: applicationIcon
                anchors.fill: parent
                source: card.notification.appIcon ? card.iconSource(card.notification.appIcon) : ""
                sourceSize: Qt.size(72, 72)
                fillMode: Image.PreserveAspectFit
                visible: contact.status !== Image.Ready
            }
            Image {
                id: contact
                objectName: "contactImage"
                anchors.fill: parent
                source: card.notification.image
                sourceSize: Qt.size(72, 72)
                fillMode: Image.PreserveAspectCrop
                visible: status === Image.Ready
            }
        }
        ColumnLayout {
            Layout.fillWidth: true
            spacing: 4
            RowLayout {
                Layout.fillWidth: true
                spacing: 8
                Label {
                    Layout.fillWidth: true
                    text: card.notification.summary
                    textFormat: Text.PlainText
                    elide: Text.ElideRight
                    color: card.style.title_color
                    font { family: card.theme.fonts.ui; pixelSize: 13; weight: Font.DemiBold }
                }
                Label {
                    Layout.maximumWidth: 80
                    visible: text !== ""
                    text: card.notification.appName
                    textFormat: Text.PlainText
                    elide: Text.ElideRight
                    color: card.style.text_color
                    opacity: 0.6
                    font { family: card.theme.fonts.ui; pixelSize: 11 }
                }
            }
            Label {
                Layout.fillWidth: true
                visible: text !== ""
                text: card.notification.body
                textFormat: Text.PlainText
                wrapMode: Text.Wrap
                maximumLineCount: card.settings.appearance.body_lines
                elide: Text.ElideRight
                color: card.style.text_color
                font { family: card.theme.fonts.ui; pixelSize: 12 }
            }
        }
    }
}
