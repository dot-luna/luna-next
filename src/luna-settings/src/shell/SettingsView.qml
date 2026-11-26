pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import "MockData.js" as Data

Rectangle {
    id: view
    required property var themeSnapshot
    property var appearanceSnapshot: Data.appearanceLibrary(themeSnapshot)
    property real surfaceOpacity: 1
    readonly property MockState mockState: mock
    readonly property bool searching: mock.query.trim() !== ""
    signal dismissed()
    implicitWidth: 1000
    implicitHeight: 720
    color: "transparent"
    focus: true

    SettingsTheme { id: colors; snapshot: view.themeSnapshot }
    MockState { id: mock; theme: view.themeSnapshot; library: view.appearanceSnapshot }

    function revealItem(item) {
        const position = item.mapToItem(pageColumn, 0, 0);
        const y = position.y + pageColumn.y;
        const top = pages.contentY;
        const bottom = top + pages.height;
        if (y < top) pages.contentY = Math.max(0, y);
        else if (y + item.height > bottom)
            pages.contentY = Math.max(0, Math.min(y + item.height - pages.height, pages.contentHeight - pages.height));
    }

    function focusSetting(key) {
        if (mock.page === "appearance" && appearance.focusSetting(key)) return;
        for (let i = 0; i < groups.count; i++) {
            const row = (groups.itemAt(i) as SettingsGroup).focusSetting(key);
            if (row) {
                revealItem(row);
                return;
            }
        }
    }

    function showPage(page, key) {
        mock.navigate(page);
        pages.contentY = 0;
        view.forceActiveFocus();
        if (key) Qt.callLater(() => focusSetting(key));
    }

    function back() {
        const previous = mock.page;
        showPage("appearance", previous);
    }

    Shortcut {
        sequence: "Ctrl+K"
        enabled: !appearance.dialogOpen
        onActivated: { search.forceActiveFocus(); search.selectAll(); }
    }
    Shortcut {
        sequence: "Alt+Left"
        enabled: mock.parentPage !== mock.page && !view.searching && !appearance.dialogOpen
        onActivated: view.back()
    }
    Shortcut {
        sequence: "Escape"
        enabled: !appearance.dialogOpen
        onActivated: {
            if (mock.query !== "") { mock.query = ""; search.forceActiveFocus(); }
            else if (mock.parentPage !== mock.page) view.back();
            else view.dismissed();
        }
    }

    Rectangle {
        objectName: "settingsSurface"
        anchors.fill: parent
        anchors.leftMargin: 191
        color: Qt.alpha(colors.surface, view.surfaceOpacity)
    }

    RowLayout {
        anchors.fill: parent
        spacing: 0

        Rectangle {
            Layout.preferredWidth: 190
            Layout.fillHeight: true
            color: Qt.alpha(colors.sidebar, view.surfaceOpacity)

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 13
                anchors.topMargin: 20
                spacing: 22

                TextField {
                    id: search
                    objectName: "settingsSearch"
                    Layout.fillWidth: true
                    implicitHeight: 37
                    placeholderText: "Search"
                    Accessible.name: "Search settings"
                    font.family: colors.font
                    font.pixelSize: 13
                    color: colors.text
                    placeholderTextColor: colors.subtle
                    leftPadding: 34
                    rightPadding: 10
                    selectByMouse: true
                    text: mock.query
                    onTextEdited: mock.query = text
                    background: Rectangle {
                        color: colors.surface
                        radius: colors.rounding
                        border.width: search.activeFocus ? Math.max(1, colors.borderWidth) : colors.borderWidth
                        border.color: search.activeFocus ? colors.accent : colors.line
                    }
                    SettingsIcon {
                        anchors.left: parent.left
                        anchors.leftMargin: 11
                        anchors.verticalCenter: parent.verticalCenter
                        width: 15
                        height: 15
                        name: "search-01"
                        ink: colors.subtle
                    }
                    Keys.onDownPressed: {
                        if (view.searching && results.count) {
                            results.currentIndex = 0;
                            results.currentItem.forceActiveFocus();
                        } else if (!view.searching) navigation.itemAt(0).forceActiveFocus();
                    }
                }

                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 5
                    Repeater {
                        id: navigation
                        model: [
                            { page: "home", label: "Home", icon: "grid-view" },
                            { page: "appearance", label: "Appearance", icon: "paint-board" }
                        ]
                        Button {
                            id: nav
                            required property var modelData
                            objectName: "nav-" + modelData.page
                            Layout.fillWidth: true
                            implicitHeight: 44
                            leftPadding: 12
                            rightPadding: 12
                            checked: mock.parentPage === modelData.page
                            hoverEnabled: true
                            Accessible.name: modelData.label
                            onClicked: view.showPage(modelData.page)
                            Keys.onReturnPressed: clicked()
                            Keys.onEnterPressed: clicked()
                            background: Rectangle {
                                radius: colors.rounding
                                color: nav.checked ? colors.selected : nav.hovered ? colors.raised : "transparent"
                                border.width: nav.visualFocus ? Math.max(1, colors.borderWidth) : 0
                                border.color: colors.accent
                                Behavior on color { ColorAnimation { duration: 90 } }
                            }
                            contentItem: RowLayout {
                                spacing: 11
                                SettingsIcon { name: nav.modelData.icon; ink: nav.checked ? colors.selectedText : colors.subtle }
                                Label {
                                    Layout.fillWidth: true
                                    text: nav.modelData.label
                                    color: nav.checked ? colors.selectedText : colors.subtle
                                    font.family: colors.font
                                    font.pixelSize: 13
                                }
                            }
                        }
                    }
                }
                Item { Layout.fillHeight: true }
            }
        }

        Rectangle { Layout.fillHeight: true; implicitWidth: 1; color: colors.borderWidth > 0 ? colors.line : "transparent" }

        Item {
            Layout.fillWidth: true
            Layout.fillHeight: true

            ColumnLayout {
                objectName: "settingsContent"
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.top: parent.top
                anchors.bottom: parent.bottom
                anchors.topMargin: 32
                anchors.bottomMargin: 23
                width: Math.min(760, parent.width - 64)
                spacing: 0

                Button {
                    id: backButton
                    objectName: "backButton"
                    visible: mock.parentPage !== mock.page && !view.searching
                    Layout.bottomMargin: 16
                    implicitHeight: 24
                    padding: 0
                    Accessible.name: "Back to Appearance"
                    onClicked: view.back()
                    Keys.onReturnPressed: clicked()
                    Keys.onEnterPressed: clicked()
                    background: Rectangle { color: "transparent"; border.width: backButton.visualFocus ? Math.max(1, colors.borderWidth) : 0; border.color: colors.accent; radius: colors.rounding }
                    contentItem: RowLayout {
                        spacing: 5
                        SettingsIcon { name: "arrow-right-01"; ink: colors.subtle; rotation: 180; width: 14; height: 14 }
                        Label { text: "Appearance"; color: colors.subtle; font.family: colors.font; font.pixelSize: 12 }
                    }
                }

                Label {
                    objectName: "pageTitle"
                    visible: mock.page !== "home" && mock.page !== "appearance" || view.searching
                    Layout.bottomMargin: visible ? 25 : 0
                    text: view.searching ? "Search" : Data.titles[mock.page]
                    color: colors.text
                    font.family: colors.font
                    font.pixelSize: 24
                    font.weight: Font.Medium
                }

                StackLayout {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    currentIndex: view.searching ? 1 : 0

                    Flickable {
                        id: pages
                        objectName: "settingsPages"
                        clip: true
                        contentWidth: width
                        contentHeight: pageColumn.implicitHeight + 6
                        boundsBehavior: Flickable.StopAtBounds
                        ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

                        Column {
                            id: pageColumn
                            x: 3
                            y: 3
                            width: pages.width - 6
                            spacing: 23

                            AppearancePage {
                                id: appearance
                                visible: mock.page === "appearance"
                                width: pageColumn.width
                                mockState: mock
                                theme: colors
                                onReveal: target => view.revealItem(target)
                            }
                            Repeater {
                                id: groups
                                model: mock.groups
                                SettingsGroup {
                                    required property var modelData
                                    width: pageColumn.width
                                    section: modelData
                                    mockState: mock
                                    theme: colors
                                    onNavigate: page => view.showPage(page)
                                    onReveal: target => view.revealItem(target)
                                }
                            }

                        }
                    }

                    ListView {
                        id: results
                        objectName: "searchResults"
                        clip: true
                        model: mock.results
                        spacing: 1
                        boundsBehavior: Flickable.StopAtBounds
                        ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }
                        delegate: Button {
                            id: result
                            required property var modelData
                            required property int index
                            objectName: "search-result-" + index
                            width: results.width
                            height: 66
                            padding: 14
                            hoverEnabled: true
                            Accessible.name: modelData.label + ", " + modelData.path
                            onClicked: view.showPage(modelData.page, modelData.key)
                            Keys.onReturnPressed: clicked()
                            Keys.onEnterPressed: clicked()
                            Keys.onDownPressed: {
                                results.currentIndex = Math.min(results.count - 1, index + 1);
                                results.currentItem.forceActiveFocus();
                                results.positionViewAtIndex(results.currentIndex, ListView.Contain);
                            }
                            Keys.onUpPressed: {
                                if (index === 0) search.forceActiveFocus();
                                else { results.currentIndex = index - 1; results.currentItem.forceActiveFocus(); results.positionViewAtIndex(results.currentIndex, ListView.Contain); }
                            }
                            background: Rectangle {
                                radius: colors.rounding
                                color: result.hovered || result.visualFocus ? colors.raised : "transparent"
                                border.color: result.visualFocus ? colors.accent : colors.line
                                border.width: result.visualFocus ? Math.max(1, colors.borderWidth) : colors.borderWidth
                            }
                            contentItem: RowLayout {
                                ColumnLayout {
                                    Layout.fillWidth: true
                                    spacing: 5
                                    Label { text: result.modelData.label; font.family: colors.font; font.pixelSize: 13; color: colors.text; textFormat: Text.PlainText }
                                    Label { text: result.modelData.path; font.family: colors.font; font.pixelSize: 12; color: colors.subtle; textFormat: Text.PlainText }
                                }
                                SettingsIcon { name: "arrow-right-01"; ink: colors.subtle; width: 14; height: 14 }
                            }
                        }
                        Label {
                            visible: results.count === 0
                            text: "No settings found."
                            color: colors.subtle
                            font.family: colors.font
                            font.pixelSize: 13
                        }
                    }
                }

                ColumnLayout {
                    objectName: "changeBar"
                    visible: mock.dirty && mock.page !== "home"
                    Layout.fillWidth: true
                    Layout.topMargin: 17
                    spacing: 15
                    Rectangle { Layout.fillWidth: true; implicitHeight: 1; color: colors.line }
                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 8
                        Label { text: "Unsaved changes"; color: colors.subtle; font.family: colors.font; font.pixelSize: 12 }
                        Item { Layout.fillWidth: true }
                        SettingsButton {
                            objectName: "discardButton"
                            theme: colors
                            text: "Discard"
                            onClicked: { mock.discard(); view.forceActiveFocus(); }
                        }
                        SettingsButton {
                            objectName: "applyButton"
                            theme: colors
                            primary: true
                            text: "Apply"
                            onClicked: { mock.apply(); view.forceActiveFocus(); }
                        }
                    }
                }
            }
        }
    }
}
