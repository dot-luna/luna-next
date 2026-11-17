pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import Quickshell
import Quickshell.Io

// Unicode data is loaded once per picker. Only visible grid cells render font glyphs.
Item {
    id: picker
    required property var theme
    required property string uiFont
    required property real textScale
    property bool active: false
    property string query: ""
    property var catalog: []
    property var selection: []
    property string error: ""
    readonly property var entries: {
        const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
        return catalog.filter(entry => {
            const text = (entry.name + " " + entry.keywords + " " + entry.emoji).toLocaleLowerCase();
            return words.every(word => text.includes(word));
        });
    }
    readonly property alias currentIndex: grid.currentIndex
    signal activated(var values)

    function reset() { selection = []; }
    function removeAt(index) { selection = selection.filter((value, position) => position !== index); }
    function choose(glyph, remove) {
        if (!glyph) return;
        if (remove) removeAt(selection.lastIndexOf(glyph));
        else if (selection.length < 256) selection = selection.concat([glyph]);
    }
    function insert() {
        const entry = entries[grid.currentIndex];
        if (selection.length) activated(selection.slice());
        else if (entry) activated([entry.emoji]);
    }
    function jump(index) {
        if (!entries.length) return;
        grid.currentIndex = Math.max(0, Math.min(entries.length - 1, index));
        grid.positionViewAtIndex(grid.currentIndex, GridView.Contain);
    }
    function handleKey(event) {
        const entry = entries[grid.currentIndex];
        if (event.key === Qt.Key_Tab || event.key === Qt.Key_Backtab)
            choose(entry ? entry.emoji : "", event.key === Qt.Key_Backtab || Boolean(event.modifiers & Qt.ShiftModifier));
        else if (event.key === Qt.Key_Backspace && query === "" && selection.length) removeAt(selection.length - 1);
        else if (event.key === Qt.Key_Left && !(event.modifiers & Qt.AltModifier)) jump(grid.currentIndex - 1);
        else if (event.key === Qt.Key_Right) jump(grid.currentIndex + 1);
        else if (event.key === Qt.Key_Up) jump(grid.currentIndex - grid.columns);
        else if (event.key === Qt.Key_Down) jump(grid.currentIndex + grid.columns);
        else if (event.key === Qt.Key_Home) jump(0);
        else if (event.key === Qt.Key_End) jump(entries.length - 1);
        else if (event.key === Qt.Key_PageUp || event.key === Qt.Key_PageDown)
            jump(grid.currentIndex + (event.key === Qt.Key_PageDown ? 1 : -1) * grid.columns * Math.max(1, Math.floor(grid.height / grid.cellHeight)));
        else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) insert();
        else return false;
        return true;
    }
    onActiveChanged: {
        reset();
        if (active && !catalog.length && !listing.running) {
            error = "";
            listing.finished = false;
            listing.running = true;
        }
    }
    onEntriesChanged: { grid.currentIndex = entries.length ? 0 : -1; grid.positionViewAtBeginning(); }

    Process {
        id: listing
        property bool finished: false
        command: [Quickshell.env("HOME") + "/.local/bin/luna", "emoji", "list", "--json"]
        stdout: StdioCollector { id: output }
        onExited: (code, status) => {
            finished = true;
            try {
                const response = JSON.parse(output.text);
                if (code || status || !response.succes) throw new Error(response.errMessage || "Emoji listing failed");
                picker.catalog = response.data;
            } catch (error) {
                picker.error = "Couldn’t load emoji";
                console.warn("Luna emoji: " + error.message);
            }
        }
        onRunningChanged: if (!running) Qt.callLater(() => {
            if (!listing.finished && !listing.running) picker.error = "Couldn’t load emoji";
        })
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 8
        RowLayout {
            visible: picker.selection.length > 0
            Layout.fillWidth: true
            Layout.preferredHeight: 42 * picker.textScale
            Flickable {
                Layout.fillWidth: true
                Layout.fillHeight: true
                contentWidth: selectedRow.width
                clip: true
                Row {
                    id: selectedRow
                    Repeater {
                        model: picker.selection
                        Button {
                            required property int index
                            required property string modelData
                            width: 40 * picker.textScale
                            height: 40 * picker.textScale
                            focusPolicy: Qt.NoFocus
                            Accessible.name: "Remove " + modelData
                            contentItem: Text {
                                text: parent.modelData
                                font.family: "Noto Color Emoji"
                                font.pixelSize: 26 * picker.textScale
                                horizontalAlignment: Text.AlignHCenter
                                verticalAlignment: Text.AlignVCenter
                            }
                            background: Item {}
                            onClicked: picker.removeAt(index)
                        }
                    }
                }
            }
            Button {
                objectName: "insertEmoji"
                text: "Insert"
                focusPolicy: Qt.NoFocus
                font.family: picker.uiFont
                palette.buttonText: picker.theme.colors.accent_foreground
                background: Rectangle { color: picker.theme.colors.accent; radius: Math.min(picker.theme.appearance.rounding, height / 2) }
                onClicked: picker.insert()
            }
        }
        GridView {
            id: grid
            objectName: "emojiGrid"
            Layout.fillWidth: true
            Layout.fillHeight: true
            readonly property int columns: Math.max(1, Math.floor(width / (64 * picker.textScale)))
            cellWidth: width / columns
            cellHeight: 64 * picker.textScale
            model: picker.entries
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }
            delegate: Button {
                id: cell
                required property int index
                required property var modelData
                width: grid.cellWidth
                height: grid.cellHeight
                padding: 8
                focusPolicy: Qt.NoFocus
                Accessible.name: modelData.name
                Accessible.description: modelData.emoji
                ToolTip.visible: hovered
                ToolTip.text: modelData.name
                ToolTip.delay: 500
                contentItem: Text {
                    text: cell.modelData.emoji
                    font.family: "Noto Color Emoji"
                    font.pixelSize: 32 * picker.textScale
                    horizontalAlignment: Text.AlignHCenter
                    verticalAlignment: Text.AlignVCenter
                }
                background: Rectangle {
                    color: grid.currentIndex === cell.index ? picker.theme.colors.selection : "transparent"
                    radius: Math.min(picker.theme.appearance.rounding, height / 2)
                    border.width: picker.selection.includes(cell.modelData.emoji) ? 1 : 0
                    border.color: picker.theme.colors.accent
                }
                // A click adds a copy; the explicit Insert button completes mouse-only input.
                onClicked: { grid.currentIndex = index; picker.choose(modelData.emoji, false); }
                MouseArea {
                    anchors.fill: parent
                    onClicked: mouse => {
                        grid.currentIndex = cell.index;
                        picker.choose(cell.modelData.emoji, Boolean(mouse.modifiers & Qt.ShiftModifier));
                    }
                }
            }
        }
    }
    Label {
        anchors.centerIn: parent
        visible: picker.entries.length === 0
        text: picker.error || (listing.running ? "Loading…" : "No matching emoji")
        color: picker.theme.colors.foreground
        font.family: picker.uiFont
    }
}
