pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Window
import QtQuick.Controls.Basic
import QtQuick.Layouts
import "Applications.js" as Applications
import "Menu.js" as Menu
import "Query.js" as Query

Rectangle {
    id: card

    required property var theme
    property var applications: []
    property bool stayAwake: false
    property string section: "root"
    // Only visited parents belong here; directly opened sections have no back target.
    property var sectionHistory: []
    readonly property bool appsView: section === "apps"
    readonly property string query: search.text
    readonly property var menuEntries: Menu.entries(stayAwake)
    readonly property var matchingEntries: appsView ? Applications.find(applications, query)
        : Menu.search(Menu.children(menuEntries, section), query).concat(
            section === "root" && query.trim() ? Applications.find(applications, query) : [])
    readonly property var entries: Query.results(matchingEntries, query)
    readonly property int selectedIndex: results.currentIndex
    readonly property var selectedEntry: entries[selectedIndex] || null
    readonly property string uiFont: Qt.fontFamilies().some(family => family.toLowerCase() === theme.fonts.ui.toLowerCase())
        ? theme.fonts.ui : "sans-serif"
    readonly property real textSize: Qt.application.font.pointSize > 0 ? Qt.application.font.pointSize : 10
    readonly property real textScale: textSize / 10
    readonly property color backgroundColor: theme.colors.background
    signal applicationActivated(var entry)
    signal actionActivated(string action)
    signal queryActivated(var entry)
    signal dismissed()

    implicitWidth: 640 * textScale
    implicitHeight: 476 * textScale
    // Only the card carries alpha; its window requests blur for this shape.
    color: Qt.rgba(backgroundColor.r, backgroundColor.g, backgroundColor.b, theme.appearance.opacity.active)
    radius: Math.min(theme.appearance.rounding, width / 2, height / 2)
    border.width: theme.appearance.border_width
    border.color: theme.colors.muted

    function focusSearch() { search.forceActiveFocus(Qt.OtherFocusReason); }
    function reset(destination) {
        sectionHistory = [];
        showSection(destination);
    }
    function showSection(destination) {
        section = destination || "root";
        search.clear();
        results.currentIndex = entries.length ? 0 : -1;
        results.positionViewAtBeginning();
    }
    function navigate(destination) {
        sectionHistory = sectionHistory.concat([section]);
        showSection(destination);
        focusSearch();
    }
    function back() {
        if (sectionHistory.length) {
            const previous = sectionHistory[sectionHistory.length - 1];
            sectionHistory = sectionHistory.slice(0, -1);
            showSection(previous);
        } else if (section === "root" && query !== "") reset();
        else dismissed();
        focusSearch();
    }
    function jumpSelection(index) {
        if (!entries.length) return;
        results.animateSelection = true;
        results.currentIndex = Math.max(0, Math.min(entries.length - 1, index));
        results.positionViewAtIndex(results.currentIndex, ListView.Contain);
    }
    function moveSelection(direction) {
        if (!entries.length) return;
        results.animateSelection = true;
        results.currentIndex = (Math.max(0, results.currentIndex) + direction + entries.length) % entries.length;
        results.positionViewAtIndex(results.currentIndex, ListView.Contain);
    }
    function pageSelection(direction) {
        const page = Math.max(1, Math.floor(results.height / (48 * textScale + results.spacing)));
        jumpSelection(results.currentIndex + direction * page);
    }
    function activate(index) {
        const entry = entries[index];
        if (!entry) return;
        if (entry.route) {
            navigate(entry.route);
        } else if (entry.queryAction) {
            queryActivated(entry);
        } else if (entry.action) {
            actionActivated(entry.action);
        } else if (typeof entry.execute === "function") {
            applicationActivated(entry);
        }
    }
    function handleKey(event) {
        if (event.key === Qt.Key_Down || event.key === Qt.Key_Tab) moveSelection(1);
        else if (event.key === Qt.Key_Up || event.key === Qt.Key_Backtab) moveSelection(-1);
        else if (event.key === Qt.Key_PageDown) pageSelection(1);
        else if (event.key === Qt.Key_PageUp) pageSelection(-1);
        else if (event.key === Qt.Key_Home) jumpSelection(0);
        else if (event.key === Qt.Key_End) jumpSelection(entries.length - 1);
        else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) activate(selectedIndex);
        else if (event.key === Qt.Key_Escape || (event.key === Qt.Key_Left && (event.modifiers & Qt.AltModifier))
                 || (event.key === Qt.Key_Backspace && query === "" && section !== "root")) back();
        else return;
        event.accepted = true;
    }
    onEntriesChanged: {
        resultTransition.stop();
        // Keep the last visible list when multiple changes arrive before the next frame.
        if (results.opacity > 0) {
            outgoingResults.model = results.model;
            outgoingResults.currentIndex = results.currentIndex;
            outgoingResults.contentY = results.contentY;
            outgoingResults.showingApps = results.showingApps;
            outgoingResults.opacity = results.opacity;
        }
        results.animateSelection = false;
        results.model = entries;
        results.showingApps = appsView;
        results.currentIndex = entries.length ? 0 : -1;
        results.positionViewAtBeginning();
        results.opacity = 0;
        resultTransition.start();
    }

    MouseArea { anchors.fill: parent; acceptedButtons: Qt.AllButtons }
    ListPointer {
        anchors.fill: parent
        view: results
        onHoveredIndex: index => {
            results.animateSelection = true;
            results.currentIndex = index;
        }
    }
    ColumnLayout {
        anchors.fill: parent
        anchors.margins: card.theme.appearance.border_width
        spacing: 0
        // The original header is a continuous search surface, without a nested box.
        Item {
            Layout.fillWidth: true
            Layout.preferredHeight: 68 * card.textScale
            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: 12
                anchors.rightMargin: 12
                spacing: 14
                Icon {
                    name: "search-01"
                    ink: search.text.length ? card.theme.colors.accent : card.theme.colors.foreground
                    Layout.preferredWidth: 20
                    Layout.preferredHeight: 20
                }
                TextField {
                    id: search
                    objectName: "searchInput"
                    Layout.fillWidth: true
                    implicitHeight: 48 * card.textScale
                    padding: 0
                    color: card.theme.colors.bright_foreground
                    font.family: card.uiFont
                    font.pointSize: card.textSize + 3
                    placeholderText: "Search…"
                    placeholderTextColor: card.theme.colors.foreground
                    selectByMouse: true
                    selectedTextColor: card.theme.colors.accent_foreground
                    selectionColor: card.theme.colors.accent
                    background: Item {}
                    Accessible.name: card.appsView ? "Search applications"
                        : card.section === "system" ? "Search system actions"
                        : card.section === "toggles" ? "Search toggles"
                        : card.section === "trigger" ? "Search triggers" : "Search menu"
                    Accessible.description: card.selectedEntry ? card.selectedEntry.name : "No matching entries"
                    Keys.priority: Keys.BeforeItem
                    Keys.onPressed: event => card.handleKey(event)
                }
                Button {
                    id: clearSearch
                    objectName: "clearSearch"
                    visible: search.text.length > 0
                    Accessible.name: "Clear search"
                    focusPolicy: Qt.NoFocus
                    implicitWidth: 28
                    implicitHeight: 28
                    padding: 7
                    background: Rectangle {
                        color: clearSearch.hovered ? card.theme.colors.selection : "transparent"
                        radius: Math.min(card.theme.appearance.rounding, height / 2)
                    }
                    contentItem: Icon { name: "cancel-01"; ink: card.theme.colors.foreground }
                    onClicked: { search.clear(); card.focusSearch(); }
                }
            }
        }
        Rectangle { Layout.fillWidth: true; implicitHeight: 1; color: card.theme.colors.muted }
        Item {
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.margins: 12
            // The outgoing view is visual only; input always uses the latest results.
            ListView {
                id: outgoingResults
                objectName: "outgoingResults"
                property bool showingApps: false
                anchors.fill: parent
                enabled: false
                interactive: false
                visible: opacity > 0
                opacity: 0
                clip: true
                spacing: 4
                delegate: MenuRow {
                    required property int index
                    required property var modelData
                    entry: modelData
                    theme: card.theme
                    uiFont: card.uiFont
                    textSize: card.textSize
                    textScale: card.textScale
                    selected: outgoingResults.currentIndex === index
                    appsView: outgoingResults.showingApps
                    width: outgoingResults.width
                }
            }
            ParallelAnimation {
                id: resultTransition
                NumberAnimation {
                    target: outgoingResults
                    property: "opacity"
                    to: 0
                    duration: 110
                    easing.type: Easing.OutCubic
                }
                NumberAnimation {
                    target: results
                    property: "opacity"
                    to: 1
                    duration: 190
                    easing.type: Easing.OutCubic
                }
                onFinished: outgoingResults.model = null
            }
            ListView {
                id: results
                objectName: "applicationList"
                // Search resets stay in place; only navigation moves the highlight.
                property bool animateSelection: false
                property bool showingApps: false
                anchors.fill: parent
                clip: true
                boundsBehavior: Flickable.StopAtBounds
                currentIndex: count ? 0 : -1
                spacing: 4
                highlightFollowsCurrentItem: false
                highlight: Rectangle {
                    width: results.width
                    height: results.currentItem ? results.currentItem.height : 0
                    y: results.currentItem ? results.currentItem.y : 0
                    visible: results.currentItem !== null
                    color: card.theme.colors.selection
                    radius: Math.min(card.theme.appearance.rounding, width / 2, height / 2)
                    z: -1
                    Behavior on y {
                        enabled: results.animateSelection
                        NumberAnimation { duration: 140; easing.type: Easing.OutCubic }
                    }
                }
                ScrollBar.vertical: ScrollBar {
                    id: scrollbar
                    policy: ScrollBar.AsNeeded
                    implicitWidth: 3
                    contentItem: Rectangle {
                        implicitWidth: 3
                        color: scrollbar.pressed ? card.theme.colors.accent : card.theme.colors.muted
                        radius: Math.min(card.theme.appearance.rounding, width / 2)
                        visible: scrollbar.size < 1
                    }
                    background: Item {}
                }
                delegate: MenuRow {
                    required property int index
                    required property var modelData
                    objectName: "applicationRow" + index
                    entry: modelData
                    theme: card.theme
                    uiFont: card.uiFont
                    textSize: card.textSize
                    textScale: card.textScale
                    selected: results.currentIndex === index
                    appsView: card.appsView
                    width: results.width
                    onClicked: {
                        results.animateSelection = true;
                        results.currentIndex = index;
                        card.activate(index);
                    }
                }
            }
            ColumnLayout {
                anchors.centerIn: parent
                spacing: 12
                visible: results.count === 0
                Icon {
                    Layout.alignment: Qt.AlignHCenter
                    Layout.preferredWidth: 28
                    Layout.preferredHeight: 28
                    name: "search-01"
                    ink: card.theme.colors.foreground
                }
                Label {
                    Layout.alignment: Qt.AlignHCenter
                    text: search.text.trim() ? "No matching entries" : "No applications found"
                    color: card.theme.colors.foreground
                    font.family: card.uiFont
                    font.pointSize: card.textSize
                }
            }
        }
    }
}
