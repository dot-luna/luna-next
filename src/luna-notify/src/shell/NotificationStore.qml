pragma ComponentBehavior: Bound
import QtQuick
import Quickshell.Services.Notifications

// The server owns live notifications; closed or expired content is never archived.
QtObject {
    id: store
    readonly property var notifications: server.trackedNotifications.values
    signal received()

    function receive(notification) {
        // Bound both visible content and retained actions during bursts, including sticky senders.
        while (notifications.length >= 3)
            notifications[0].expire();
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
