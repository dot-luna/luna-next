pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Layouts

Item {
    id: footer
    required property var settings
    required property var login
    signal actionRequested(string action)
    readonly property var theme: settings.theme
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
            ].filter(item => footer.login.supportedActions.indexOf(item.action) >= 0)
            delegate: LoginIconButton {
                required property var modelData
                objectName: modelData.action + "Button"
                theme: footer.theme
                iconName: modelData.icon
                text: modelData.label
                enabled: !footer.login.busy
                onClicked: footer.actionRequested(modelData.action)
            }
        }
    }
}
