pragma ComponentBehavior: Bound
import QtQuick
import Quickshell.Services.Notifications

// The server owns live notifications; closed or expired content is never archived.
QtObject {
    id: store
    property int limit: 3
    readonly property var notifications: server.trackedNotifications.values
    signal received()

    function persistent(notification) {
        return notification.expireTimeout === 0
            || (notification.expireTimeout < 0 && notification.urgency === NotificationUrgency.Critical);
    }
    function receive(notification) {
        // Preserve sender-requested persistence and critical alerts with no timeout.
        // Sticky bursts may exceed the limit and remain reachable when expanded.
        while (notifications.length >= limit) {
            const oldest = notifications.find(item => !persistent(item));
            if (oldest) oldest.expire();
            else if (persistent(notification)) break;
            else {
                notification.expire();
                return;
            }
        }
        notification.tracked = true;
        received();
    }
    function dismiss() {
        if (notifications.length)
            notifications[notifications.length - 1].dismiss();
    }
    property NotificationServer server: NotificationServer {
        keepOnReload: false
        persistenceSupported: false
        bodySupported: true
        bodyMarkupSupported: false
        bodyHyperlinksSupported: false
        bodyImagesSupported: false
        actionsSupported: true
        actionIconsSupported: false
        imageSupported: true
        inlineReplySupported: false
        onNotification: notification => store.receive(notification)
    }
}
