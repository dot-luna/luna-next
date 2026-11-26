pragma ComponentBehavior: Bound
import QtQuick
import "."
import QtQuick.Layouts

Item {
    id: footer
    required property var lock
    signal actionRequested(string action)
    readonly property var theme: lock.theme
    implicitHeight: 54
    implicitWidth: actions.implicitWidth

    RowLayout {
        id: actions
        anchors.centerIn: parent
        spacing: 14
        Repeater {
            model: [
                {
                    action: "suspend",
                    icon: "moon-02",
                    label: qsTr("Sleep")
                },
                {
                    action: "hibernate",
                    icon: "snowflake",
                    label: qsTr("Hibernate")
                },
                {
                    action: "hybridSleep",
                    icon: "power-service",
                    label: qsTr("Hybrid sleep")
                },
                {
                    action: "reboot",
                    icon: "refresh",
                    label: qsTr("Restart")
                },
                {
                    action: "powerOff",
                    icon: "shut-down",
                    label: qsTr("Shut down")
                }
            ].filter(item => footer.lock.supportedActions.indexOf(item.action) >= 0)
            delegate: ScreenIconButton {
                required property var modelData
                objectName: modelData.action + "Button"
                theme: footer.theme
                iconName: modelData.icon
                text: modelData.label
                enabled: !footer.lock.busy && !footer.lock.actions?.busy
                onClicked: footer.actionRequested(modelData.action)
            }
        }
    }
}
