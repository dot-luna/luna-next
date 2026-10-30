pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import Quickshell
import "Applications.js" as Applications

Rectangle {
    id: card

    required property var theme
    property var applications: []
    property bool appsView: false
    readonly property string query: search.text
    readonly property var entries: !appsView && query.trim() === ""
        ? [{name: "Apps", route: "apps", comment: "Installed applications", icon: "view-app-grid"}]
        : Applications.find(applications, query)
    readonly property int selectedIndex: selection.currentIndex
    signal applicationActivated(var entry)
    signal dismissed()

    implicitWidth: 580
    implicitHeight: layout.implicitHeight + 40
    color: theme.colors.background
    radius: Math.min(theme.appearance.rounding, width / 2, height / 2)
    border.width: theme.appearance.border_width
    border.color: theme.colors.muted

    function focusSearch() {
        search.forceActiveFocus(Qt.OtherFocusReason);
    }

    function reset() {
        appsView = false;
        search.text = "";
        selection.currentIndex = entries.length ? 0 : -1;
        selection.positionViewAtBeginning();
    }

    function back() {
        if (appsView || query !== "")
            reset();
        else
            dismissed();
        focusSearch();
    }

    function moveSelection(direction) {
        if (!entries.length)
            return;
        selection.currentIndex = (Math.max(0, selection.currentIndex) + direction + entries.length) % entries.length;
        selection.positionViewAtIndex(selection.currentIndex, ListView.Contain);
    }

    function activate(index) {
        const entry = entries[index];
        if (!entry)
            return;
        if (entry.route === "apps") {
            appsView = true;
            search.text = "";
            focusSearch();
        } else {
            applicationActivated(entry);
        }
    }

    function handleKey(event) {
        if (event.key === Qt.Key_Down || event.key === Qt.Key_Tab)
            moveSelection(1);
        else if (event.key === Qt.Key_Up || event.key === Qt.Key_Backtab)
            moveSelection(-1);
        else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter)
            activate(selection.currentIndex);
        else if (event.key === Qt.Key_Escape || (event.key === Qt.Key_Left && (event.modifiers & Qt.AltModifier))
                 || (event.key === Qt.Key_Backspace && query === "" && appsView))
            back();
        else
            return;
        event.accepted = true;
    }

    onEntriesChanged: {
        selection.currentIndex = entries.length ? 0 : -1;
        selection.positionViewAtBeginning();
    }

    // Clicks inside the card that miss a control must not reach the dismiss surface.
    MouseArea { anchors.fill: parent; acceptedButtons: Qt.AllButtons }

    ColumnLayout {
        id: layout
        anchors { fill: parent; margins: 20 }
        spacing: 12

        RowLayout {
            spacing: 10
            Button {
                id: backButton
                objectName: "backButton"
                visible: card.appsView || card.query !== ""
                text: "‹"
                focusPolicy: Qt.NoFocus
                implicitWidth: 28
                implicitHeight: 28
                Accessible.name: "Back to menu"
                onClicked: card.back()
                contentItem: Text {
                    text: backButton.text
                    color: card.theme.colors.foreground
                    font.family: card.theme.fonts.ui
                    font.pixelSize: 22
                    horizontalAlignment: Text.AlignHCenter
                    verticalAlignment: Text.AlignVCenter
                }
                background: Rectangle {
                    color: backButton.hovered ? card.theme.colors.selection : "transparent"
                    radius: Math.min(6, card.theme.appearance.rounding)
                }
            }
            Label {
                Layout.fillWidth: true
                text: card.appsView || card.query.trim() !== "" ? "Apps" : "Menu"
                color: card.theme.colors.bright_foreground
                font.family: card.theme.fonts.ui
                font.pixelSize: 17
                font.weight: Font.DemiBold
            }
        }

        TextField {
            id: search
            objectName: "searchInput"
            Layout.fillWidth: true
            implicitHeight: 42
            placeholderText: "Search applications…"
            placeholderTextColor: card.theme.colors.foreground
            color: card.theme.colors.bright_foreground
            selectionColor: card.theme.colors.selection
            selectedTextColor: card.theme.colors.selection_foreground
            font.family: card.theme.fonts.ui
            font.pixelSize: 14
            selectByMouse: true
            padding: 10
            Accessible.name: "Search applications"
            background: Rectangle {
                color: card.theme.colors.lighter_background
                radius: Math.min(8, card.theme.appearance.rounding)
                border.width: 1
                border.color: search.activeFocus ? card.theme.colors.accent : card.theme.colors.muted
            }
            Keys.priority: Keys.BeforeItem
            Keys.onPressed: event => card.handleKey(event)
        }

        Item {
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.preferredHeight: Math.min(336, Math.max(56, card.entries.length * 56))

            ListView {
                id: selection
                objectName: "applicationList"
                anchors.fill: parent
                clip: true
                model: card.entries
                currentIndex: count ? 0 : -1
                boundsBehavior: Flickable.StopAtBounds
                ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

                delegate: Rectangle {
                    id: row
                    required property var modelData
                    required property int index
                    objectName: "applicationRow" + index
                    width: selection.width
                    height: 56
                    radius: Math.min(8, card.theme.appearance.rounding)
                    color: ListView.isCurrentItem ? card.theme.colors.selection : "transparent"

                    RowLayout {
                        anchors { fill: parent; leftMargin: 12; rightMargin: 12 }
                        spacing: 12
                        Item {
                            implicitWidth: 28
                            implicitHeight: 28
                            Image {
                                id: icon
                                anchors.fill: parent
                                source: row.modelData.icon ? Quickshell.iconPath(row.modelData.icon, true) : ""
                                sourceSize.width: 28
                                sourceSize.height: 28
                                asynchronous: true
                                visible: status === Image.Ready
                            }
                            Text {
                                anchors.centerIn: parent
                                visible: icon.status !== Image.Ready
                                text: row.modelData.route ? "▦" : row.modelData.name.slice(0, 1).toLocaleUpperCase()
                                color: row.ListView.isCurrentItem ? card.theme.colors.selection_foreground : card.theme.colors.accent
                                font.family: card.theme.fonts.ui
                                font.pixelSize: 22
                            }
                        }
                        Label {
                            Layout.fillWidth: true
                            text: row.modelData.name
                            textFormat: Text.PlainText
                            elide: Text.ElideRight
                            color: row.ListView.isCurrentItem ? card.theme.colors.selection_foreground : card.theme.colors.foreground
                            font.family: card.theme.fonts.ui
                            font.pixelSize: 14
                            font.weight: Font.Medium
                        }
                        Label {
                            visible: row.modelData.route === "apps"
                            text: "›"
                            color: card.theme.colors.selection_foreground
                            font.family: card.theme.fonts.ui
                            font.pixelSize: 22
                        }
                    }

                    MouseArea {
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onEntered: selection.currentIndex = row.index
                        onClicked: card.activate(row.index)
                    }
                }
            }
            Label {
                anchors.centerIn: parent
                visible: card.entries.length === 0
                text: "No applications found"
                color: card.theme.colors.foreground
                font.family: card.theme.fonts.ui
                font.pixelSize: 13
            }
        }

    }
}
