pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Dialogs
import QtQuick.Layouts
import Luna.UI 1.0 as UI

Column {
    id: section
    required property UI.Theme theme
    required property var themes
    readonly property bool dialogOpen: importer.visible || fileDialog.visible || folderDialog.visible || localMenu.visible
    signal reveal(Item target)
    signal changed()
    spacing: 12

    function focusSetting() {
        if (!choices.count) { importTile.focusImport(); reveal(importTile); return; }
        const index = Math.max(0, themes.entries.findIndex(entry => entry.current));
        const item = choices.itemAt(index);
        item.forceActiveFocus();
        reveal(item);
    }
    RowLayout {
        width: parent.width
        UI.Subtitle { theme: section.theme; objectName: "themeTitle"; Layout.fillWidth: true; text: "Theme"; color: section.theme.text }
        UI.Button {
            objectName: "randomTheme"
            visible: section.themes.entries.length > 3
            theme: section.theme
            variant: UI.Button.Ghost
            implicitWidth: 36; implicitHeight: 36
            horizontalPadding: 8; verticalPadding: 8
            enabled: section.themes.entries.length > 0 && !section.themes.busy
            Accessible.name: "Random theme"
            onClicked: section.themes.run("random")
            onActiveFocusChanged: if (activeFocus) section.reveal(this)
            contentItem: SettingsIcon { name: "shuffle"; ink: section.theme.text }
        }
    }
    GridLayout {
        id: grid
        width: parent.width
        columns: Math.max(1, Math.min(3, Math.floor((width + 12) / 170)))
        columnSpacing: 12
        rowSpacing: 12
        ImportTile {
            id: importTile
            objectName: "themeImportTile"
            namePrefix: "Theme"
            kind: "theme"
            Layout.fillWidth: true
            Layout.minimumWidth: 0
            Layout.preferredWidth: (grid.width - (grid.columns - 1) * 12) / grid.columns
            implicitHeight: 174
            theme: section.theme
            busy: section.themes.busy
            onChooseFile: localMenu.popup()
            onChooseUrl: importer.start("")
            onReveal: target => section.reveal(target)
            Keys.onRightPressed: if (choices.count) choices.itemAt(0).forceActiveFocus()
            Keys.onDownPressed: if (choices.count >= grid.columns) choices.itemAt(grid.columns - 1).forceActiveFocus()
            Menu {
                id: localMenu
                objectName: "themeLocalMenu"
                y: importTile.height / 2
                font.family: section.theme.font
                palette.text: section.theme.text
                palette.buttonText: section.theme.text
                palette.highlightedText: section.theme.text
                palette.highlight: section.theme.raised
                background: Rectangle { color: section.theme.surface; radius: section.theme.rounding; border.width: 1; border.color: section.theme.line }
                MenuItem { text: "Choose File"; onTriggered: fileDialog.open() }
                MenuItem { text: "Choose Folder"; onTriggered: folderDialog.open() }
            }
        }
        Repeater {
            id: choices
            model: section.themes.entries
            ThemeChoice {
                required property var modelData
                required property int index
                Layout.fillWidth: true
                Layout.minimumWidth: 0
                Layout.preferredWidth: (grid.width - (grid.columns - 1) * 12) / grid.columns
                theme: section.theme
                entry: modelData
                selected: modelData.current
                applied: modelData.current
                enabled: !section.themes.busy
                onChosen: section.themes.run("select", modelData.name)
                onRemoved: section.themes.run("remove", modelData.name)
                onReveal: target => section.reveal(target)
                Keys.onRightPressed: if (index + 1 < choices.count) choices.itemAt(index + 1).forceActiveFocus()
                Keys.onLeftPressed: { if (index > 0) choices.itemAt(index - 1).forceActiveFocus(); else importTile.focusImport(); }
                Keys.onDownPressed: if (index + grid.columns < choices.count) choices.itemAt(index + grid.columns).forceActiveFocus()
                Keys.onUpPressed: { if (index >= grid.columns) choices.itemAt(index - grid.columns).forceActiveFocus(); else if (index + 1 === grid.columns) importTile.focusImport(); }
            }
        }
    }
    UI.Text {
        objectName: "themeError"
        theme: section.theme
        width: parent.width
        visible: section.themes.errorMessage !== "" && !importer.visible
        text: section.themes.errorMessage
        color: section.theme.error
    }
    ThemeImportDialog { id: importer; parent: Overlay.overlay; anchors.centerIn: parent; theme: section.theme; themes: section.themes }
    FileDialog {
        id: fileDialog
        objectName: "themeFileDialog"
        title: "Install Theme"
        nameFilters: ["Themes (*.json *.jsonc)"]
        onAccepted: importer.start(selectedFile.toString())
    }
    FolderDialog {
        id: folderDialog
        objectName: "themeFolderDialog"
        title: "Install Theme Folder"
        onAccepted: importer.start(selectedFolder.toString())
    }
    Connections {
        target: section.themes
        function onFinished(action, success) {
            if (success && action !== "preview" && action !== "list") {
                section.changed();
                Qt.callLater(section.focusSetting);
            }
        }
    }
}
