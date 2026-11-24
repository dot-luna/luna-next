pragma ComponentBehavior: Bound
// Quickshell exports these model/screen members at runtime, but omits them from qmltypes.
// qmllint disable missing-property unresolved-type
import QtQuick
import Quickshell
import Quickshell.Networking
import Quickshell.Bluetooth
import Quickshell.Services.UPower
import Quickshell.Services.Mpris

// Live desktop services are shared across monitors; config and theme remain startup snapshots.
Item {
    id: state
    readonly property var audio: AudioState {}
    readonly property var wifi: Networking.devices.values.find(device => device.type === DeviceType.Wifi) ?? null
    readonly property var wired: Networking.devices.values.find(device => device.type === DeviceType.Wired && device.connected) ?? null
    readonly property bool wifiEnabled: Networking.wifiEnabled
    readonly property var network: wifi ? wifi.networks.values.find(network => network.connected) ?? null : null
    readonly property string networkIcon: wired ? "ethernet-port" : wifiEnabled ? "wifi-01" : "wifi-off-01"
    readonly property string networkName: wired ? "Wired" : network ? network.name : "Wi-Fi"
    readonly property var bluetooth: Bluetooth.defaultAdapter
    readonly property var battery: UPower.displayDevice
    readonly property bool hasBattery: battery.ready && battery.isPresent
    readonly property int batteryPercent: Math.round(battery.percentage * 100)
    readonly property bool charging: battery.state === UPowerDeviceState.Charging
    readonly property string batteryIcon: charging ? "battery-charging-01" : batteryPercent < 15 ? "battery-empty"
        : batteryPercent < 35 ? "battery-low" : batteryPercent < 70 ? "battery-medium-01" : "battery-full"
    readonly property string batteryDetail: {
        const seconds = charging ? battery.timeToFull : battery.timeToEmpty;
        const status = charging ? "Charging" : battery.state === UPowerDeviceState.FullyCharged ? "Full" : "Battery";
        return status + (seconds > 0 ? " · " + Math.floor(seconds / 3600) + "h " + Math.floor(seconds % 3600 / 60) + "m" : "");
    }
    readonly property var player: Mpris.players.values.find(player => player.isPlaying)
        ?? Mpris.players.values.find(player => player.playbackState === MprisPlaybackState.Paused) ?? null
    readonly property string launcher: Quickshell.env("HOME") + "/.local/bin/luna"
    property real brightness: 0
    property bool hasBrightness: false
    property bool stayAwake: false
    property bool dark: false
    property string error: ""
    property real pendingBrightness: -1
    readonly property bool busy: action.running

    function refresh() {
        error = "";
        if (!brightnessRead.running && !brightnessWrite.running) brightnessRead.run(["brightnessctl", "--class=backlight", "-m"]);
        awakeRead.run([launcher, "toggle", "stay-awake", "status", "--json"]);
        modeRead.run([launcher, "theme", "mode", "--json"]);
    }
    function toggleWifi() { Networking.wifiEnabled = !Networking.wifiEnabled; }
    function setBrightness(value) {
        pendingBrightness = Math.max(1, Math.round(value * 100));
        brightness = pendingBrightness / 100;
        flushBrightness();
    }
    function flushBrightness() {
        if (brightnessWrite.running || pendingBrightness < 0) return;
        const value = pendingBrightness;
        pendingBrightness = -1;
        brightnessWrite.run(["brightnessctl", "--class=backlight", "set", value + "%"]);
    }
    function run(args) { error = ""; action.run([launcher].concat(args)); }
    PanelCommand {
        id: brightnessRead
        onSucceeded: output => {
            const match = output.match(/,(\d+)%,/);
            state.hasBrightness = !!match;
            if (match) state.brightness = Number(match[1]) / 100;
        }
        onFailed: state.hasBrightness = false
    }
    PanelCommand {
        id: brightnessWrite
        onSucceeded: state.flushBrightness()
        onFailed: {
            state.pendingBrightness = -1;
            state.refresh();
            state.error = "Could not change brightness";
        }
    }
    PanelCommand {
        id: awakeRead
        onSucceeded: output => {
            try { state.stayAwake = JSON.parse(output).data.enabled; }
            catch (error) { state.error = "Could not read Stay awake"; }
        }
        onFailed: state.error = "Could not read Stay awake"
    }
    PanelCommand {
        id: modeRead
        onSucceeded: output => {
            try { state.dark = JSON.parse(output).data === "dark"; }
            catch (error) { state.error = "Could not read theme mode"; }
        }
        onFailed: state.error = "Could not read theme mode"
    }
    PanelCommand {
        id: action
        onSucceeded: state.refresh()
        onFailed: state.error = "Could not complete action"
    }
    Component.onCompleted: refresh()
}
