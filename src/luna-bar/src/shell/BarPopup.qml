pragma ComponentBehavior: Bound
import QtQuick
import Quickshell
import Quickshell.Wayland
import Quickshell.Hyprland

// A card attached under the bar, centred or at its right edge. Clicking outside closes it;
// content closes it on Escape. Size the popup with implicitWidth/implicitHeight.
PanelWindow {
    id: popup
    required property var theme
    required property var barWindow
    /** Distance from the screen's top edge. */
    required property int top
    /** "center" or "right". */
    property string side: "center"
    property bool open: false
    // Native tray menus temporarily own focus until their menu closes.
    property bool menuOpen: false
    property string namespace: "luna-bar-popup"
    default property alias content: card.data
    property real reveal: open ? 1 : 0
    Behavior on reveal { NumberAnimation { duration: 160; easing.type: Easing.OutCubic } }

    visible: open || reveal > 0
    color: "transparent"
    // Ignore other exclusive zones so `top` is measured from the screen edge, below the bar.
    exclusionMode: ExclusionMode.Ignore
    anchors.top: true
    anchors.right: side === "right"
    // qmllint disable missing-property
    margins.top: top
    margins.right: side === "right" ? barWindow.gap : 0
    // qmllint enable missing-property
    mask: open ? null : noInput
    WlrLayershell.namespace: namespace
    WlrLayershell.layer: WlrLayer.Top
    WlrLayershell.keyboardFocus: open && !menuOpen ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None

    Region { id: noInput }

    // Follow the theme's blur like the menu card, so content behind stays legible.
    BackgroundEffect.blurRegion: theme.appearance.blur && theme.appearance.blur.enabled ? blur : null
    Region {
        id: blur
        item: card
        radius: card.radius
    }

    // Clicks on the bar keep the grab, so its buttons can switch or close popups themselves.
    HyprlandFocusGrab {
        active: popup.open && !popup.menuOpen
        windows: [popup, popup.barWindow]
        onCleared: popup.open = false
    }

    Rectangle {
        id: card
        anchors.fill: parent
        opacity: popup.reveal
        transform: Translate { y: (popup.reveal - 1) * 8 }
        color: Qt.alpha(popup.theme.colors.background, popup.theme.appearance.opacity.active)
        border.color: popup.theme.colors.muted
        border.width: popup.theme.appearance.border_width
        radius: popup.theme.appearance.rounding
    }
}
