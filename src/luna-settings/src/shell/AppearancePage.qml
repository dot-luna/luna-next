pragma ComponentBehavior: Bound

import QtQuick
import Luna.UI 1.0 as UI
import QtQuick.Controls.Basic
import QtQuick.Dialogs
import QtQuick.Layouts

Column {
    id: page
    required property var backgrounds
    required property var themes
    required property UI.Theme theme
    readonly property bool dialogOpen: themeSection.dialogOpen || pictureDialog.visible || downloadDialog.visible
    signal reveal(Item target)
    spacing: 24

    function focusSetting(key) {
        if (key === "theme") { themeSection.focusSetting(); return true; }
        if (key === "background") {
            if (!backgroundChoices.count) { importTile.focusImport(); reveal(importTile); return true; }
            const index = Math.max(0, backgrounds.entries.findIndex(entry => entry.current));
            const item = backgroundChoices.itemAt(index);
            item.forceActiveFocus();
            reveal(item);
            return true;
        }
        return false;
    }

    ThemeSection {
        id: themeSection
        width: parent.width
        theme: page.theme
        themes: page.themes
        enabled: !page.backgrounds.busy || page.backgrounds.operation === "list"
        onReveal: target => page.reveal(target)
        onChanged: page.backgrounds.run("list")
    }
    Column {
        enabled: !page.themes.busy
        width: parent.width
        spacing: 12
        RowLayout {
            width: parent.width
            UI.Subtitle { theme: page.theme; objectName: "backgroundTitle"; Layout.fillWidth: true; text: "Background"; color: page.theme.text }
            UI.Button {
                objectName: "randomBackground"
                visible: page.backgrounds.entries.length > 3
                theme: page.theme
                variant: UI.Button.Ghost
                implicitWidth: 36
                implicitHeight: 36
                padding: 8
                horizontalPadding: 8
                verticalPadding: 8
                enabled: page.backgrounds.entries.length > 0 && !page.backgrounds.busy
                Accessible.name: "Random wallpaper"
                onClicked: page.backgrounds.run("random")
                onActiveFocusChanged: if (activeFocus) page.reveal(this)
                contentItem: SettingsIcon { name: "shuffle"; ink: page.theme.text }
            }
        }
        GridLayout {
            id: backgroundGrid
            width: parent.width
            columns: Math.max(1, Math.min(3, Math.floor((width + 12) / 150)))
            columnSpacing: 12
            rowSpacing: 12
            ImportTile {
                id: importTile
                objectName: "backgroundImportTile"
                Layout.fillWidth: true
                Layout.minimumWidth: 0
                Layout.preferredWidth: (backgroundGrid.width - (backgroundGrid.columns - 1) * 12) / backgroundGrid.columns
                theme: page.theme
                busy: page.backgrounds.busy
                onChooseFile: pictureDialog.open()
                onChooseUrl: downloadDialog.open()
                onReveal: target => page.reveal(target)
                Keys.onRightPressed: if (backgroundChoices.count) backgroundChoices.itemAt(0).forceActiveFocus()
                Keys.onDownPressed: if (backgroundChoices.count >= backgroundGrid.columns) backgroundChoices.itemAt(backgroundGrid.columns - 1).forceActiveFocus()
            }
            Repeater {
                id: backgroundChoices
                model: page.backgrounds.entries
                BackgroundChoice {
                    required property var modelData
                    required property int index
                    Layout.fillWidth: true
                    Layout.minimumWidth: 0
                    Layout.preferredWidth: (backgroundGrid.width - (backgroundGrid.columns - 1) * 12) / backgroundGrid.columns
                    theme: page.theme
                    entry: modelData
                    enabled: !page.backgrounds.busy
                    onChosen: page.backgrounds.run("select", modelData.name)
                    onRemoved: page.backgrounds.run("remove", modelData.name)
                    onReveal: target => page.reveal(target)
                    Keys.onRightPressed: if (index + 1 < backgroundChoices.count) backgroundChoices.itemAt(index + 1).forceActiveFocus()
                    Keys.onLeftPressed: { if (index > 0) backgroundChoices.itemAt(index - 1).forceActiveFocus(); else importTile.focusImport(); }
                    Keys.onDownPressed: if (index + backgroundGrid.columns < backgroundChoices.count) backgroundChoices.itemAt(index + backgroundGrid.columns).forceActiveFocus()
                    Keys.onUpPressed: { if (index >= backgroundGrid.columns) backgroundChoices.itemAt(index - backgroundGrid.columns).forceActiveFocus(); else if (index + 1 === backgroundGrid.columns) importTile.focusImport(); }
                }
            }
        }
    }
    UI.Text {
        objectName: "backgroundError"
        theme: page.theme
        width: parent.width
        visible: page.backgrounds.errorMessage !== ""
        text: page.backgrounds.errorMessage
        color: page.theme.error
    }
    UI.InputDialog {
        id: downloadDialog
        objectName: "backgroundDownloadDialog"
        parent: Overlay.overlay
        anchors.centerIn: parent
        theme: page.theme
        title: "Download Wallpaper"
        fieldLabel: "Image URL"
        placeholderText: "https://example.com/wallpaper.jpg"
        actionText: "Download"
        busy: page.backgrounds.busy
        onSubmitted: value => page.backgrounds.run("install", value)
    }
    Connections {
        target: page.backgrounds
        function onFinished(action, success) {
            if (downloadDialog.visible && action === "install") {
                if (success) downloadDialog.close();
                else downloadDialog.errorMessage = page.backgrounds.errorMessage;
            }
            if (success && (action === "remove" || action === "select" || action === "random"))
                Qt.callLater(() => page.focusSetting("background"));
        }
    }
    FileDialog {
        id: pictureDialog
        objectName: "backgroundFileDialog"
        title: "Install Wallpaper"
        nameFilters: ["Images (*.png *.jpg *.jpeg *.webp *.avif *.gif *.bmp *.svg)"]
        onAccepted: page.backgrounds.run("install", selectedFile.toString())
    }
}
