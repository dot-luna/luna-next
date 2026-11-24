pragma ComponentBehavior: Bound
import QtQuick

Column {
    id: home
    required property var theme
    required property var settings
    required property var services
    signal navigate(string page)
    signal dismissed()
    spacing: 12

    Repeater {
        model: home.settings.sliders
        ControlSlider {
            id: slider
            required property string modelData
            readonly property var node: modelData === "input" ? home.services.audio.input : home.services.audio.output
            width: home.width
            theme: home.theme
            label: modelData === "input" ? "Microphone" : modelData === "output" ? "Volume" : "Brightness"
            visible: modelData !== "brightness" || home.services.hasBrightness
            enabled: modelData === "brightness" || !!node
            iconName: modelData === "brightness" ? "sun-03" : modelData === "input"
                ? (node && node.audio.muted ? "mic-off-01" : "mic-01") : home.services.audio.outputIcon
            value: modelData === "brightness" ? home.services.brightness : node ? node.audio.volume : 0
            iconClickable: modelData !== "brightness"
            hasMore: modelData !== "brightness"
            onMoved: value => {
                if (modelData === "brightness") home.services.setBrightness(value);
                else if (node) node.audio.volume = value;
            }
            onIconClicked: if (node) node.audio.muted = !node.audio.muted
            onMore: home.navigate(modelData)
        }
    }
    Grid {
        width: parent.width
        columns: 2
        spacing: 8
        Repeater {
            model: home.settings.tiles
            Tile {
                required property string modelData
                width: (home.width - 8) / 2
                theme: home.theme
                iconName: modelData === "network" ? home.services.networkIcon : modelData === "bluetooth" ? "bluetooth"
                    : modelData === "dark_mode" ? "moon-02" : "coffee-02"
                label: modelData === "network" ? home.services.networkName : modelData === "bluetooth" ? "Bluetooth"
                    : modelData === "dark_mode" ? "Dark mode" : "Stay awake"
                detail: modelData === "network" ? (home.services.wired ? "Connected" : home.services.network ? "Connected"
                    : home.services.wifiEnabled ? "Not connected" : "Off") : ""
                active: modelData === "network" ? !!home.services.wired || home.services.wifiEnabled
                    : modelData === "bluetooth" ? !!home.services.bluetooth && home.services.bluetooth.enabled
                    : modelData === "dark_mode" ? home.services.dark : home.services.stayAwake
                hasMore: modelData === "network" || modelData === "bluetooth"
                // Wired is status only; the chevron still opens Wi-Fi controls.
                toggleEnabled: modelData !== "network" || !home.services.wired
                enabled: modelData === "bluetooth" ? !!home.services.bluetooth : !home.services.busy
                onMore: home.navigate(modelData === "network" ? "wifi" : "bluetooth")
                onToggled: {
                    if (modelData === "network") {
                        home.services.toggleWifi();
                    } else if (modelData === "bluetooth") home.services.bluetooth.enabled = !home.services.bluetooth.enabled;
                    else if (modelData === "dark_mode") home.services.run(["theme", "mode", "toggle", "--json"]);
                    else home.services.run(["toggle", "stay-awake", "toggle", "--json"]);
                }
            }
        }
    }
    PanelText {
        width: parent.width
        theme: home.theme
        visible: home.services.audio.activeRecording.length > 0
        text: "Microphone · " + home.services.audio.activeRecording.map(node => home.services.audio.label(node)).join(", ")
        opacity: 0.7
    }
    Column {
        width: parent.width
        visible: home.settings.media && !!home.services.player
        spacing: 4
        PanelText {
            width: parent.width
            theme: home.theme
            text: home.services.player ? home.services.player.trackTitle || home.services.player.identity : ""
            maximumLineCount: 1
            elide: Text.ElideRight
        }
        PanelText {
            width: parent.width
            theme: home.theme
            text: home.services.player ? home.services.player.trackArtist : ""
            visible: text !== ""
            maximumLineCount: 1
            elide: Text.ElideRight
            opacity: 0.6
        }
        Row {
            anchors.horizontalCenter: parent.horizontalCenter
            spacing: 12
            IconButton {
                theme: home.theme; iconName: "previous"; Accessible.name: "Previous track"
                enabled: !!home.services.player && home.services.player.canGoPrevious
                onClicked: home.services.player.previous()
            }
            IconButton {
                theme: home.theme; iconName: home.services.player && home.services.player.isPlaying ? "pause" : "play"
                Accessible.name: "Play or pause"
                enabled: !!home.services.player && home.services.player.canTogglePlaying
                onClicked: home.services.player.togglePlaying()
            }
            IconButton {
                theme: home.theme; iconName: "next"; Accessible.name: "Next track"
                enabled: !!home.services.player && home.services.player.canGoNext
                onClicked: home.services.player.next()
            }
        }
    }
    Item {
        width: parent.width
        height: 32
        Row {
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            spacing: 6
            visible: home.services.hasBattery
            Icon {
                width: 18; height: 18
                anchors.verticalCenter: parent.verticalCenter
                name: home.services.batteryIcon
                ink: home.theme.colors.foreground
            }
            Column {
                PanelText { theme: home.theme; text: home.services.batteryPercent + "%" }
                PanelText { theme: home.theme; text: home.services.batteryDetail; font.pixelSize: 10; opacity: 0.6 }
            }
        }
        Row {
            anchors.right: parent.right
            spacing: 8
            IconButton {
                theme: home.theme; iconName: "square-lock-02"; framed: true; Accessible.name: "Lock"
                onClicked: { home.dismissed(); home.services.run(["lock"]); }
            }
            IconButton {
                theme: home.theme; iconName: "shut-down"; framed: true; Accessible.name: "Power options"
                onClicked: { home.dismissed(); home.services.run(["menu", "system"]); }
            }
        }
    }
    PanelText { width: parent.width; theme: home.theme; text: home.services.error; visible: text !== "" }
}
