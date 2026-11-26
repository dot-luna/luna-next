pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Dialogs
import QtQuick.Layouts

Column {
    id: page
    required property MockState mockState
    required property SettingsTheme theme
    readonly property bool dialogOpen: repositoryDialog.visible || pictureDialog.visible
    signal reveal(Item target)
    spacing: 24

    function focusSetting(key) {
        if (key === "theme" && themeChoices.count) {
            const index = Math.max(0, mockState.draft.appearance.themes.findIndex(entry => entry.name === mockState.draft.appearance.theme));
            themeChoices.itemAt(index).forceActiveFocus();
            return true;
        }
        if (key === "background" && backgroundChoices.count) {
            const index = Math.max(0, mockState.draft.appearance.backgrounds.findIndex(entry => entry.source === mockState.draft.appearance.background));
            backgroundChoices.itemAt(index).forceActiveFocus();
            return true;
        }
        return false;
    }

    RowLayout {
        width: parent.width
        Label { objectName: "styleTitle"; Layout.fillWidth: true; text: "Style"; font.family: page.theme.font; font.pixelSize: 15; font.weight: Font.Medium; color: page.theme.text }
        SettingsButton { objectName: "addThemeButton"; theme: page.theme; text: "Add Theme"; flat: true; onClicked: repositoryDialog.open() }
    }
    GridLayout {
        id: themeGrid
        width: parent.width
        columns: Math.max(1, Math.min(3, Math.floor((width + 12) / 170)))
        columnSpacing: 12
        rowSpacing: 12
        Repeater {
            id: themeChoices
            model: page.mockState.draft.appearance.themes
            ThemeChoice {
                id: choice
                required property var modelData
                required property int index
                Layout.fillWidth: true
                Layout.minimumWidth: 0
                Layout.preferredWidth: (themeGrid.width - (themeGrid.columns - 1) * 12) / themeGrid.columns
                theme: page.theme
                entry: modelData
                selected: page.mockState.draft.appearance.theme === modelData.name
                applied: page.mockState.saved.appearance.theme === modelData.name
                onChosen: page.mockState.setValue("appearance", "theme", modelData.name)
                onRemoved: { page.mockState.removeTheme(modelData.name); page.focusSetting("theme"); }
                onReveal: target => page.reveal(target)
                Keys.onRightPressed: if (index + 1 < themeChoices.count) themeChoices.itemAt(index + 1).forceActiveFocus()
                Keys.onLeftPressed: if (index > 0) themeChoices.itemAt(index - 1).forceActiveFocus()
                Keys.onDownPressed: if (index + themeGrid.columns < themeChoices.count) themeChoices.itemAt(index + themeGrid.columns).forceActiveFocus()
                Keys.onUpPressed: if (index >= themeGrid.columns) themeChoices.itemAt(index - themeGrid.columns).forceActiveFocus()
            }
        }
    }
    Column {
        width: parent.width
        spacing: 12
        RowLayout {
            width: parent.width
            Label { objectName: "backgroundTitle"; Layout.fillWidth: true; text: "Background"; font.family: page.theme.font; font.pixelSize: 15; font.weight: Font.Medium; color: page.theme.text }
            SettingsButton { objectName: "addBackgroundButton"; theme: page.theme; text: "Add Picture…"; flat: true; onClicked: pictureDialog.open() }
        }
        GridLayout {
            id: backgroundGrid
            width: parent.width
            columns: Math.max(1, Math.min(3, Math.floor((width + 12) / 150)))
            columnSpacing: 12
            rowSpacing: 12
            Repeater {
                id: backgroundChoices
                model: page.mockState.draft.appearance.backgrounds
                BackgroundChoice {
                    required property var modelData
                    required property int index
                    Layout.fillWidth: true
                    Layout.minimumWidth: 0
                    Layout.preferredWidth: (backgroundGrid.width - (backgroundGrid.columns - 1) * 12) / backgroundGrid.columns
                    theme: page.theme
                    entry: modelData
                    selected: page.mockState.draft.appearance.background === modelData.source
                    applied: page.mockState.saved.appearance.background === modelData.source
                    onChosen: page.mockState.setValue("appearance", "background", modelData.source)
                    onRemoved: { page.mockState.removeBackground(modelData.source); page.focusSetting("background"); }
                    onReveal: target => page.reveal(target)
                    Keys.onRightPressed: if (index + 1 < backgroundChoices.count) backgroundChoices.itemAt(index + 1).forceActiveFocus()
                    Keys.onLeftPressed: if (index > 0) backgroundChoices.itemAt(index - 1).forceActiveFocus()
                    Keys.onDownPressed: if (index + backgroundGrid.columns < backgroundChoices.count) backgroundChoices.itemAt(index + backgroundGrid.columns).forceActiveFocus()
                    Keys.onUpPressed: if (index >= backgroundGrid.columns) backgroundChoices.itemAt(index - backgroundGrid.columns).forceActiveFocus()
                }
            }
        }
    }
    ThemeRepositoryDialog {
        id: repositoryDialog
        parent: Overlay.overlay
        anchors.centerIn: parent
        theme: page.theme
        mockState: page.mockState
    }
    FileDialog {
        id: pictureDialog
        objectName: "backgroundFileDialog"
        title: "Add Background"
        nameFilters: ["Images (*.png *.jpg *.jpeg *.webp *.avif *.gif *.bmp *.svg)"]
        onAccepted: page.mockState.addBackground(selectedFile.toString())
    }
}
