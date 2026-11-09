pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import Quickshell

ShellRoot {
    id: shell
    readonly property var theme: JSON.parse(Quickshell.env("LUNA_SETTINGS_THEME"))
    Component.onCompleted: Quickshell.watchFiles = false

    ApplicationWindow {
        id: window
        width: 1080; height: 820
        minimumWidth: 860; minimumHeight: 600
        visible: true
        title: "Luna Settings"
        font.family: shell.theme.fonts.ui
        font.pixelSize: 13
        color: palette.window
        palette {
            window: shell.theme.colors.background
            windowText: shell.theme.colors.foreground
            base: shell.theme.colors.lighter_background
            alternateBase: shell.theme.colors.selection
            text: shell.theme.colors.foreground
            buttonText: shell.theme.colors.foreground
            button: shell.theme.colors.lighter_background
            mid: shell.theme.colors.muted
            dark: shell.theme.colors.background
            light: shell.theme.colors.lighter_background
            highlight: shell.theme.colors.accent
            highlightedText: shell.theme.colors.accent_foreground
            placeholderText: shell.theme.colors.muted
        }
        property string page: "hardware"
        property string focusTarget: "power"
        readonly property bool searching: search.text.trim().length > 0
        readonly property var settings: [
            { title: "Power mode", group: "Performance", terms: "power performance balanced energy saver", page: "hardware", target: "power" },
            { title: "Fan control", group: "Performance", terms: "fans cooling cpu gpu temperature noise speed automatic manual maximum", page: "fans", target: "" },
            { title: "Charge limit", group: "Battery", terms: "battery charging charge limit 80", page: "hardware", target: "charge" },
            { title: "Battery health", group: "Battery", terms: "battery health capacity cycles power adapter", page: "battery", target: "" },
            { title: "Backlight timeout", group: "Keyboard", terms: "keyboard light backlight timeout 30", page: "hardware", target: "keyboard" }
        ]
        readonly property var matches: settings.filter(entry => search.text.trim().toLowerCase().split(/\s+/).every(word =>
            (entry.title + " " + entry.group + " " + entry.terms + " hardware").toLowerCase().includes(word)))

        HardwareModel { id: hardware }

        function navigate(destination, target) {
            focusTarget = target || "power";
            search.clear();
            page = destination;
            scroll.contentY = 0;
            Qt.callLater(focusCurrentPage);
        }
        function focusPage(content) { if (content) content.focusSetting(focusTarget); }
        function focusCurrentPage() { focusPage(pageLoader.item); }
        function back() {
            if (searching) {
                search.clear();
                search.forceActiveFocus();
            } else if (page !== "hardware") {
                const target = page === "fans" ? "fans" : "health";
                navigate("hardware", target);
            }
        }
        function activateResult() {
            const entry = matches[Math.max(0, results.currentIndex)];
            if (entry) navigate(entry.page, entry.target);
        }
        // Tab navigation and search destinations reveal controls without waiting for an animation.
        function reveal(control) {
            if (!control || !pageLoader.item) return;
            let ancestor = control;
            while (ancestor && ancestor !== pageLoader.item) ancestor = ancestor.parent;
            if (!ancestor) return;
            const top = control.mapToItem(scroll.contentItem, 0, 0).y;
            if (top < scroll.contentY + 16) scroll.contentY = Math.max(0, top - 16);
            else if (top + control.height > scroll.contentY + scroll.height - 16)
                scroll.contentY = Math.min(scroll.contentHeight - scroll.height, top + control.height - scroll.height + 16);
        }
        onActiveFocusItemChanged: reveal(activeFocusItem)
        onClosing: Qt.quit()

        Shortcut { sequences: ["Ctrl+F", "Ctrl+K"]; onActivated: { search.forceActiveFocus(); search.selectAll(); } }
        Shortcut { sequence: "Alt+Left"; enabled: window.searching || window.page !== "hardware"; onActivated: window.back() }
        Shortcut { sequence: "Escape"; enabled: window.searching || window.page !== "hardware"; onActivated: window.back() }
        Shortcut { sequence: "Ctrl+W"; onActivated: window.close() }

        header: Rectangle {
            height: 76
            color: window.palette.window
            MouseArea { anchors.fill: parent; onPressed: window.startSystemMove() }
            Label {
                anchors { left: parent.left; leftMargin: 24; verticalCenter: parent.verticalCenter }
                text: "Luna Settings"
                font.weight: Font.DemiBold
            }
            ToolButton {
                id: backButton
                x: 238; anchors.verticalCenter: parent.verticalCenter
                visible: window.page !== "hardware" || window.searching
                Accessible.name: "Back"
                implicitWidth: 36; implicitHeight: 36
                contentItem: Icon { name: "arrow-right-01"; rotation: 180; ink: window.palette.text }
                ToolTip.visible: hovered
                ToolTip.text: "Back · Alt+Left"
                onClicked: window.back()
            }
            TextField {
                id: search
                anchors.centerIn: parent
                width: Math.min(360, parent.width - 580)
                height: 40
                placeholderText: "Search settings"
                Accessible.name: "Search settings"
                leftPadding: 39; rightPadding: 34
                selectByMouse: true
                background: Rectangle {
                    radius: shell.theme.appearance.rounding
                    color: window.palette.base
                    border.color: search.activeFocus ? window.palette.highlight : window.palette.mid
                    Behavior on border.color { ColorAnimation { duration: 100 } }
                }
                Icon {
                    x: 13; anchors.verticalCenter: parent.verticalCenter
                    name: "search-01"; ink: window.palette.placeholderText
                    width: 17; height: 17
                }
                ToolButton {
                    anchors { right: parent.right; rightMargin: 3; verticalCenter: parent.verticalCenter }
                    visible: search.text.length > 0
                    width: 30; height: 30
                    Accessible.name: "Clear search"
                    contentItem: Icon { name: "cancel-01"; ink: window.palette.placeholderText }
                    onClicked: { search.clear(); search.forceActiveFocus(); }
                }
                onTextChanged: results.currentIndex = window.matches.length ? 0 : -1
                onAccepted: if (window.searching) window.activateResult()
                Keys.onDownPressed: if (window.searching && window.matches.length) results.forceActiveFocus(Qt.TabFocusReason)
            }
            Rectangle { anchors { left: parent.left; right: parent.right; bottom: parent.bottom } height: 1; color: window.palette.mid }
        }

        Rectangle {
            id: sidebar
            width: 220
            anchors { left: parent.left; top: parent.top; bottom: parent.bottom }
            color: window.palette.base
            Button {
                id: hardwareButton
                x: 14; y: 20; width: parent.width - 28; height: 46
                text: "Hardware"
                Accessible.name: "Hardware settings"
                palette.buttonText: down || hovered ? window.palette.highlightedText : shell.theme.colors.selection_foreground
                background: Rectangle {
                    radius: shell.theme.appearance.rounding
                    color: hardwareButton.down || hardwareButton.hovered ? window.palette.highlight : window.palette.alternateBase
                    border.width: hardwareButton.visualFocus ? 1 : 0
                    border.color: window.palette.highlight
                    Behavior on color { ColorAnimation { duration: 100 } }
                }
                contentItem: RowLayout {
                    spacing: 12
                    Icon { name: "computer"; ink: hardwareButton.palette.buttonText; Layout.leftMargin: 10 }
                    Label { text: hardwareButton.text; font.weight: Font.DemiBold; color: hardwareButton.palette.buttonText; Layout.fillWidth: true }
                }
                onClicked: window.navigate("hardware", "power")
            }
            Rectangle { anchors { right: parent.right; top: parent.top; bottom: parent.bottom } width: 1; color: window.palette.mid }
        }

        Flickable {
            id: scroll
            anchors { left: sidebar.right; right: parent.right; top: parent.top; bottom: parent.bottom }
            visible: !window.searching
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            contentWidth: width
            contentHeight: pageLoader.height + 72
            ScrollBar.vertical: ScrollBar {}
            Loader {
                id: pageLoader
                x: Math.max(30, (scroll.width - 710) / 2); y: 32
                width: Math.min(710, scroll.width - 60)
                sourceComponent: window.page === "fans" ? fansPage : window.page === "battery" ? batteryPage : hardwarePage
                onLoaded: { entrance.restart(); Qt.callLater(window.focusCurrentPage); }
                NumberAnimation { id: entrance; target: pageLoader; property: "opacity"; from: 0; to: 1; duration: 130; easing.type: Easing.OutCubic }
            }
        }
        ColumnLayout {
            visible: window.searching
            anchors { left: sidebar.right; right: parent.right; top: parent.top; bottom: parent.bottom; margins: 32 }
            spacing: 20
            Label { text: "Search results"; font.pixelSize: 16; font.weight: Font.DemiBold }
            Label { visible: !window.matches.length; text: "No settings found"; color: window.palette.placeholderText }
            ListView {
                id: results
                Layout.fillWidth: true; Layout.fillHeight: true
                clip: true
                spacing: 6
                model: window.matches
                keyNavigationEnabled: true
                activeFocusOnTab: true
                Keys.onReturnPressed: window.activateResult()
                Keys.onEnterPressed: window.activateResult()
                delegate: ItemDelegate {
                    id: result
                    required property var modelData
                    required property int index
                    width: results.width; height: 72
                    highlighted: ListView.isCurrentItem
                    Accessible.name: modelData.title + ", " + modelData.group
                    contentItem: RowLayout {
                        ColumnLayout {
                            Layout.fillWidth: true; spacing: 5
                            Label { text: result.modelData.title; color: result.highlighted || result.hovered ? shell.theme.colors.selection_foreground : window.palette.text }
                            Label { text: "Hardware · " + result.modelData.group; color: result.highlighted || result.hovered ? shell.theme.colors.selection_foreground : window.palette.placeholderText; font.pixelSize: 12 }
                        }
                        Icon { name: "arrow-right-01"; ink: result.highlighted || result.hovered ? shell.theme.colors.selection_foreground : window.palette.placeholderText }
                    }
                    background: Rectangle {
                        radius: shell.theme.appearance.rounding
                        color: result.highlighted || result.hovered ? window.palette.alternateBase : "transparent"
                        border.width: result.visualFocus || (results.activeFocus && result.highlighted) ? 1 : 0
                        border.color: window.palette.highlight
                    }
                    onClicked: window.navigate(modelData.page, modelData.target)
                }
                ScrollBar.vertical: ScrollBar {}
            }
        }

        Component { id: hardwarePage; HardwarePage { api: hardware; onNavigate: destination => window.navigate(destination, ""); onReveal: control => window.reveal(control) } }
        Component { id: fansPage; FanPage { api: hardware; onReveal: control => window.reveal(control) } }
        Component { id: batteryPage; BatteryPage { api: hardware } }
    }
}
