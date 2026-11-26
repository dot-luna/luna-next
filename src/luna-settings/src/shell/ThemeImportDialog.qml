pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import Luna.UI 1.0 as UI

UI.Dialog {
    id: dialog
    required property var themes
    property string source: ""
    property var plan: null
    property string errorMessage: ""
    property bool accepting: false
    objectName: "themeImportDialog"
    title: plan ? "Install Theme" : "Download Theme"
    width: Math.min(480, parent ? parent.width - 40 : 480)

    function start(value) {
        source = value || "";
        plan = null;
        errorMessage = "";
        open();
        if (source) themes.run("preview", source);
        else sourceInput.forceActiveFocus();
    }
    function submit() {
        if (themes.busy) return;
        errorMessage = "";
        if (!plan) {
            source = sourceInput.text.trim();
            if (source) themes.run("preview", source);
        } else if (nameInput.text.trim()) {
            accepting = true;
            themes.run("install", source, nameInput.text.trim(), plan.fingerprint);
        }
    }
    contentItem: ColumnLayout {
        spacing: 12
        UI.Text { theme: dialog.theme; text: dialog.plan ? "Name" : "Theme URL" }
        TextField {
            id: sourceInput
            objectName: "themeSourceInput"
            Layout.fillWidth: true
            visible: !dialog.plan
            implicitHeight: 38
            placeholderText: "https://github.com/user/themes/tree/main/theme"
            Accessible.name: "Theme URL"
            selectByMouse: true
            readOnly: dialog.themes.busy
            font.family: dialog.theme.font
            font.pixelSize: 13
            color: dialog.theme.text
            placeholderTextColor: dialog.theme.subtle
            onAccepted: dialog.submit()
            background: Rectangle {
                color: dialog.theme.raised
                radius: dialog.theme.rounding
                border.width: 1
                border.color: sourceInput.activeFocus ? dialog.theme.accent : dialog.theme.line
            }
        }
        TextField {
            id: nameInput
            objectName: "themeNameInput"
            Layout.fillWidth: true
            visible: dialog.plan !== null
            implicitHeight: 38
            Accessible.name: "Theme name"
            selectByMouse: true
            readOnly: dialog.themes.busy
            color: dialog.theme.text
            font.family: dialog.theme.font
            font.pixelSize: 13
            onAccepted: dialog.submit()
            background: Rectangle {
                color: dialog.theme.raised
                radius: dialog.theme.rounding
                border.width: 1
                border.color: nameInput.activeFocus ? dialog.theme.accent : dialog.theme.line
            }
        }
        ScrollView {
            visible: dialog.plan !== null
            Layout.fillWidth: true
            Layout.preferredHeight: Math.min(240, preview.implicitHeight)
            clip: true
            UI.Text {
                id: preview
                objectName: "themeDownloadPreview"
                theme: dialog.theme
                width: parent.width
                text: {
                    const plan = dialog.plan;
                    if (!plan) return "";
                    const lines = ["Fonts: " + plan.fonts.ui + ", " + plan.fonts.mono];
                    if (plan.remote) {
                        lines.push("Files to download:");
                        for (const file of plan.files) lines.push(file.path);
                    }
                    if (plan.wallpapers.length) lines.push("Wallpapers: " + plan.wallpapers.join(", "));
                    for (const pkg of plan.packages)
                        lines.push(pkg.name + " · " + pkg.source + (pkg.installed ? " · installed" : " · will install"));
                    return lines.join("\n");
                }
            }
        }
        UI.Text {
            objectName: "themeImportError"
            theme: dialog.theme
            Layout.fillWidth: true
            visible: dialog.errorMessage !== ""
            text: dialog.errorMessage
            color: dialog.theme.error
        }
        RowLayout {
            Layout.fillWidth: true
            Layout.topMargin: 8
            Item { Layout.fillWidth: true }
            UI.Button {
                theme: dialog.theme
                variant: UI.Button.Outline
                text: "Cancel"
                onClicked: dialog.close()
            }
            UI.Button {
                objectName: "themeImportSubmit"
                theme: dialog.theme
                text: dialog.themes.busy ? "Working…" : dialog.plan ? "Install" : "Continue"
                enabled: !dialog.themes.busy && (dialog.plan ? nameInput.text.trim() !== "" : sourceInput.text.trim() !== "")
                onClicked: dialog.submit()
            }
        }
    }
    onAboutToShow: { sourceInput.text = source; accepting = false; }
    // Dismissal leaves the request running; its confirmed result still updates the gallery.
    closePolicy: Popup.CloseOnEscape
    Connections {
        target: dialog.themes
        function onFinished(action, success) {
            if (!dialog.visible) return;
            if (action === "preview") {
                if (success) {
                    dialog.plan = dialog.themes.preview;
                    nameInput.text = dialog.plan.suggestedName;
                    nameInput.forceActiveFocus();
                    nameInput.selectAll();
                } else dialog.errorMessage = dialog.themes.errorMessage;
            } else if (action === "install" && dialog.accepting) {
                dialog.accepting = false;
                if (success) dialog.close();
                else dialog.errorMessage = dialog.themes.errorMessage;
            }
        }
    }
}
