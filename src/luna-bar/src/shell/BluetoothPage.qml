pragma ComponentBehavior: Bound
import QtQuick
import Quickshell.Bluetooth
import Quickshell

Column {
    id: page
    required property var theme
    required property var services
    readonly property var adapter: services.bluetooth
    property bool scanning: true
    Component.onDestruction: scanning = false
    signal back()
    signal dismissed()
    spacing: 8
    Binding {
        target: page.adapter
        property: "discovering"
        value: true
        when: page.scanning && !!page.adapter && page.adapter.enabled
        restoreMode: Binding.RestoreBindingOrValue
    }
    PageHeader {
        width: parent.width
        theme: page.theme
        title: "Bluetooth"
        hasSwitch: !!page.adapter
        checked: page.adapter ? page.adapter.enabled : false
        onSwitched: if (page.adapter) page.adapter.enabled = !page.adapter.enabled
        onBack: page.back()
    }
    Repeater {
        model: page.adapter && page.adapter.enabled ? page.adapter.devices.values : []
        ListRow {
            required property var modelData
            width: page.width
            theme: page.theme
            iconName: "bluetooth"
            label: modelData.name || modelData.address
            detail: modelData.pairing ? "Pairing…" : modelData.connected ? "Connected"
                : modelData.state === BluetoothDeviceState.Connecting ? "Connecting…" : modelData.paired ? "Paired" : "Pair device"
            trailing: modelData.connected ? "tick-02" : ""
            selected: modelData.connected
            enabled: !modelData.pairing && [BluetoothDeviceState.Connected, BluetoothDeviceState.Disconnected].includes(modelData.state)
            onClicked: {
                if (modelData.paired) modelData.connected = !modelData.connected;
                else {
                    // Blueman supplies the PIN/confirmation agent that BlueZ requires for pairing.
                    page.dismissed();
                    Quickshell.execDetached(["blueman-manager"]);
                }
            }
        }
    }
    PanelText {
        width: parent.width
        theme: page.theme
        visible: !page.adapter || !page.adapter.enabled || !page.adapter.devices.values.length
        text: !page.adapter ? "No Bluetooth adapter" : !page.adapter.enabled ? "Bluetooth is off" : "Searching for devices…"
        opacity: 0.6
    }
}
