import QtQuick

// Track pointer motion in a fixed viewport, not in delegates that move during scroll.
Item {
    id: root
    required property var view
    signal hoveredIndex(int index)

    HoverHandler {
        property point previousPosition: Qt.point(0, 0)
        property bool havePosition: false

        onHoveredChanged: if (!hovered) havePosition = false
        onPointChanged: {
            const position = point.position;
            const moved = havePosition && (position.x !== previousPosition.x || position.y !== previousPosition.y);
            previousPosition = position;
            havePosition = true;
            if (!hovered || !moved)
                return;
            const local = root.view.mapFromItem(root, position.x, position.y);
            if (local.x < 0 || local.y < 0 || local.x >= root.view.width || local.y >= root.view.height)
                return;
            const index = root.view.indexAt(local.x + root.view.contentX, local.y + root.view.contentY);
            if (index >= 0)
                root.hoveredIndex(index);
        }
    }
}

