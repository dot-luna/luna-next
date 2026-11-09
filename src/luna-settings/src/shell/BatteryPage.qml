pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

ColumnLayout {
    id: page
    required property HardwareModel api
    spacing: 26

    function focusSetting(target) { heading.forceActiveFocus(Qt.TabFocusReason); }

    Label { id: heading; text: "Battery health"; font.pixelSize: 16; font.weight: Font.DemiBold }
    SettingGroup {
        title: "Condition"
        Layout.fillWidth: true
        SettingRow {
            title: "Maximum capacity"
            description: "Compared with original capacity."
            Label { text: page.api.healthPercent + "%"; color: palette.highlight }
        }
        SettingRow {
            title: "Cycle count"
            divided: true
            Label { text: page.api.cycles; color: palette.placeholderText }
        }
    }
    SettingGroup {
        title: "Charging"
        Layout.fillWidth: true
        SettingRow {
            title: "Battery level"
            Label { text: page.api.batteryPercentage + "%"; color: palette.placeholderText }
        }
        SettingRow {
            title: "Power source"
            divided: true
            Label { text: page.api.onBattery ? "Battery" : "Power adapter"; color: palette.placeholderText }
        }
        SettingRow {
            title: "Charge limit"
            divided: true
            Label { text: page.api.chargeLimit ? "80%" : "Off"; color: palette.placeholderText }
        }
    }
}
