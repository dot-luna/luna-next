pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

ColumnLayout {
    id: page
    required property HardwareModel api
    signal reveal(Item control)
    // Keep the chosen mode while dragging, including when both manual sliders reach 100%.
    property int mode: api.cpuFan === 0 && api.gpuFan === 0 ? 0
        : api.cpuFan === 100 && api.gpuFan === 100 ? 2 : 1
    spacing: 26

    function focusSetting(target) { automatic.forceActiveFocus(Qt.TabFocusReason); }

    Label { text: "Fan control"; font.pixelSize: 16; font.weight: Font.DemiBold }
    SettingGroup {
        title: "Cooling mode"
        Layout.fillWidth: true
        ButtonGroup { id: modes }
        RowLayout {
            Layout.fillWidth: true
            Layout.margins: 14
            spacing: 12
            RadioButton {
                id: automatic
                text: "Automatic"
                checked: page.mode === 0
                ButtonGroup.group: modes
                onClicked: { page.mode = 0; page.api.setFans(0, 0); }
            }
            RadioButton {
                text: "Manual"
                checked: page.mode === 1
                ButtonGroup.group: modes
                onClicked: if (page.mode !== 1) { page.mode = 1; page.api.setFans(50, 50); }
            }
            RadioButton {
                text: "Maximum"
                checked: page.mode === 2
                ButtonGroup.group: modes
                onClicked: { page.mode = 2; page.api.setFans(100, 100); }
            }
            Item { Layout.fillWidth: true }
        }
    }
    SettingGroup {
        title: "Fans"
        Layout.fillWidth: true
        Repeater {
            model: ["CPU", "GPU"]
            delegate: ColumnLayout {
                id: fan
                required property string modelData
                required property int index
                Layout.fillWidth: true
                spacing: 0
                SettingRow {
                    title: fan.modelData
                    description: (fan.index === 0 ? page.api.cpuTemp : page.api.gpuTemp) + " °C"
                    divided: fan.index > 0
                    Label {
                        text: (fan.index === 0 ? page.api.cpuRpm : page.api.gpuRpm).toLocaleString(Qt.locale(), 'f', 0) + " RPM"
                        color: palette.placeholderText
                    }
                }
                RowLayout {
                    visible: page.mode === 1
                    Layout.fillWidth: true
                    Layout.leftMargin: 20
                    Layout.rightMargin: 20
                    Layout.bottomMargin: 18
                    spacing: 18
                    Slider {
                        id: speed
                        Layout.fillWidth: true
                        from: 1; to: 100; stepSize: 1
                        value: fan.index === 0 ? page.api.cpuFan : page.api.gpuFan
                        Accessible.name: fan.modelData + " fan speed"
                        onMoved: page.api.setFans(fan.index === 0 ? Math.round(value) : page.api.cpuFan,
                            fan.index === 1 ? Math.round(value) : page.api.gpuFan)
                        onActiveFocusChanged: if (activeFocus) page.reveal(speed)
                    }
                    Label { text: Math.round(speed.value) + "%"; Layout.minimumWidth: 38; horizontalAlignment: Text.AlignRight }
                }
            }
        }
    }
}
