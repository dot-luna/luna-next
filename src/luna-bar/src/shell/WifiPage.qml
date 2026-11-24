pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic
import Quickshell.Networking

Column {
    id: page
    required property var theme
    required property var services
    property var selectedNetwork: null
    property bool needsPassword: false
    property string error: ""
    property bool scanning: true
    Component.onDestruction: scanning = false
    signal back()
    spacing: 8
    readonly property var networks: services.wifi ? services.wifi.networks.values.slice().sort(
        (a, b) => Number(b.connected) - Number(a.connected) || b.signalStrength - a.signalStrength) : []

    function isPsk(network) {
        return [WifiSecurityType.WpaPsk, WifiSecurityType.Wpa2Psk, WifiSecurityType.Sae].includes(network.security);
    }
    function choose(network) {
        error = "";
        password.clear();
        selectedNetwork = network;
        needsPassword = false;
        if (network.connected) network.disconnect();
        else if (!network.known && isPsk(network)) needsPassword = true;
        else if (!network.known && ![WifiSecurityType.Open, WifiSecurityType.Owe].includes(network.security))
            error = "Set up this network in NetworkManager first";
        else network.connect();
    }
    function connectPassword() {
        if (!selectedNetwork || !password.text) return;
        selectedNetwork.connectWithPsk(password.text);
        password.clear();
        needsPassword = false;
    }
    // Scanning is owned by this visible page; closing/unloading it releases the scanner.
    Binding {
        target: page.services.wifi
        property: "scannerEnabled"
        value: true
        when: page.scanning && !!page.services.wifi
        restoreMode: Binding.RestoreBindingOrValue
    }
    Connections {
        target: page.selectedNetwork
        function onConnectionFailed(reason) {
            page.error = "Could not connect: " + ConnectionFailReason.toString(reason);
            page.needsPassword = !!page.selectedNetwork && page.isPsk(page.selectedNetwork);
        }
    }
    PageHeader {
        width: parent.width
        theme: page.theme
        title: "Wi-Fi"
        hasSwitch: !!page.services.wifi
        checked: page.services.wifiEnabled
        onSwitched: page.services.toggleWifi()
        onBack: page.back()
    }
    Repeater {
        model: page.services.wifiEnabled ? page.networks : []
        ListRow {
            required property var modelData
            width: page.width
            theme: page.theme
            iconName: "wifi-01"
            label: modelData.name || "Hidden network"
            detail: modelData.stateChanging ? "Connecting…" : modelData.connected ? "Connected"
                : Math.round(modelData.signalStrength * 100) + "%"
            trailing: modelData.connected ? "tick-02" : modelData.security === WifiSecurityType.Open ? "" : "lock-key"
            selected: modelData.connected
            enabled: !modelData.stateChanging
            onClicked: page.choose(modelData)
        }
    }
    PanelText {
        width: parent.width
        theme: page.theme
        visible: !page.services.wifi || !page.services.wifiEnabled || !page.networks.length
        text: !page.services.wifi ? "No Wi-Fi adapter" : !page.services.wifiEnabled ? "Wi-Fi is off" : "Searching for networks…"
        opacity: 0.6
    }
    Column {
        width: parent.width
        spacing: 6
        visible: page.needsPassword
        PanelText {
            theme: page.theme
            text: page.selectedNetwork ? page.selectedNetwork.name : ""
        }
        TextField {
            id: password
            objectName: "wifiPassword"
            width: parent.width
            echoMode: TextInput.Password
            placeholderText: "Password"
            Accessible.name: "Wi-Fi password"
            color: page.theme.colors.foreground
            placeholderTextColor: Qt.alpha(page.theme.colors.foreground, 0.5)
            selectionColor: page.theme.colors.accent
            selectedTextColor: page.theme.colors.background
            font.family: page.theme.fonts.ui
            font.pixelSize: 12
            onAccepted: page.connectPassword()
            background: Rectangle {
                color: "transparent"
                border.width: 1
                border.color: password.activeFocus ? page.theme.colors.accent : page.theme.colors.muted
                radius: page.theme.appearance.rounding
            }
        }
        ListRow {
            width: parent.width
            theme: page.theme
            label: "Connect"
            trailing: "arrow-right-01"
            enabled: password.text.length > 0
            onClicked: page.connectPassword()
        }
    }
    PanelText { width: parent.width; theme: page.theme; text: page.error; visible: text !== "" }
}
