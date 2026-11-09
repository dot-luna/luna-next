pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

ColumnLayout {
    id: page
    required property HardwareModel api
    signal navigate(string destination)
    signal reveal(Item control)
    spacing: 26

    function focusSetting(target) {
        const control = target === "fans" ? fans : target === "charge" ? charge
            : target === "health" ? health : target === "keyboard" ? keyboard : power;
        control.forceActiveFocus(Qt.TabFocusReason);
        reveal(control);
    }

    Label { text: "Hardware"; font.pixelSize: 16; font.weight: Font.DemiBold }
    SettingGroup {
        title: "Performance"
        Layout.fillWidth: true
        SettingRow {
            title: "Power mode"
            ComboBox {
                id: power
                Accessible.name: "Power mode"
                implicitWidth: 166
                model: ["Power saver", "Balanced", "Performance"]
                currentIndex: ["power-saver", "balanced", "performance"].indexOf(page.api.profile)
                onActivated: page.api.setProfile(["power-saver", "balanced", "performance"][currentIndex])
            }
        }
        SettingRow {
            title: "Fan control"
            divided: true
            Button {
                id: fans
                text: (page.api.cpuFan === 0 && page.api.gpuFan === 0) ? "Automatic"
                    : (page.api.cpuFan === 100 && page.api.gpuFan === 100) ? "Maximum" : "Manual"
                flat: true
                Accessible.name: "Fan control, " + text
                contentItem: RowLayout {
                    Label { text: fans.text; color: palette.placeholderText }
                    Icon { name: "arrow-right-01"; ink: fans.palette.placeholderText }
                }
                onClicked: page.navigate("fans")
            }
        }
    }
    SettingGroup {
        title: "Battery"
        Layout.fillWidth: true
        SettingRow {
            title: page.api.batteryPercentage + "%"
            description: page.api.onBattery ? "On battery" : "Plugged in"
            ProgressBar {
                value: page.api.batteryPercentage / 100
                implicitWidth: 112
                Accessible.name: "Battery level"
            }
        }
        SettingRow {
            title: "Charge limit"
            description: "Stop charging at 80%."
            divided: true
            SettingSwitch {
                id: charge
                Accessible.name: "Limit battery charging to 80%"
                checked: page.api.chargeLimit
                onToggled: page.api.setChargeLimit(checked)
            }
        }
        SettingRow {
            title: "Battery health"
            divided: true
            Button {
                id: health
                text: page.api.healthPercent + "%"
                flat: true
                Accessible.name: "Battery health, " + text
                contentItem: RowLayout {
                    Label { text: health.text; color: palette.placeholderText }
                    Icon { name: "arrow-right-01"; ink: health.palette.placeholderText }
                }
                onClicked: page.navigate("battery")
            }
        }
    }
    SettingGroup {
        title: "Keyboard"
        Layout.fillWidth: true
        SettingRow {
            title: "Backlight timeout"
            description: "Turn off after 30 seconds of inactivity."
            SettingSwitch {
                id: keyboard
                Accessible.name: "Keyboard backlight timeout"
                checked: page.api.keyboardTimeout
                onToggled: page.api.setKeyboardTimeout(checked)
            }
        }
    }
}
