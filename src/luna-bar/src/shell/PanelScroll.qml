pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Window
import QtQuick.Controls.Basic

// Keep Tab navigation visible without changing focus or waiting for scroll animations.
Flickable {
    id: scroll
    clip: true
    boundsBehavior: Flickable.StopAtBounds
    ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

    function revealFocus() {
        const focused = Window.window ? Window.window.activeFocusItem : null;
        let ancestor = focused;
        while (ancestor && ancestor !== contentItem) ancestor = ancestor.parent;
        if (!ancestor || !focused) return;
        const y = focused.mapToItem(contentItem, 0, 0).y;
        if (y < contentY) contentY = Math.max(0, y);
        else if (y + focused.height > contentY + height)
            contentY = Math.min(Math.max(0, contentHeight - height), y + focused.height - height);
    }
    Connections {
        target: scroll.Window.window
        function onActiveFocusItemChanged() { scroll.revealFocus(); }
    }
}
