pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls.Basic as Controls
import "." as Components

// Shared modal surface and transitions; content and actions belong to the caller.
Controls.Dialog {
    id: dialog
    required property Components.Theme theme
    modal: true
    focus: true
    width: Math.min(430, parent ? parent.width - 40 : 430)
    padding: 22
    closePolicy: Controls.Popup.CloseOnEscape
    enter: Transition {
        ParallelAnimation {
            NumberAnimation { property: "opacity"; from: 0; to: 1; duration: 140; easing.type: Easing.OutCubic }
            NumberAnimation { property: "scale"; from: 0.97; to: 1; duration: 160; easing.type: Easing.OutCubic }
        }
    }
    exit: Transition {
        ParallelAnimation {
            NumberAnimation { property: "opacity"; to: 0; duration: 100; easing.type: Easing.InCubic }
            NumberAnimation { property: "scale"; to: 0.98; duration: 100; easing.type: Easing.InCubic }
        }
    }
    background: Rectangle {
        color: dialog.theme.surface
        radius: dialog.theme.rounding
        border.width: Math.max(1, dialog.theme.borderWidth)
        border.color: dialog.theme.line
    }
    Controls.Overlay.modal: Rectangle { color: Qt.alpha(dialog.theme.sidebar, 0.65) }
    header: Components.Title {
        theme: dialog.theme
        text: dialog.title
        padding: 22
        bottomPadding: 4
    }
}
