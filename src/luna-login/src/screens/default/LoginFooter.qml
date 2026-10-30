pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

Item {
    id: footer
    required property var settings
    required property var login
    implicitHeight: buttons.implicitHeight

    component ActionButton: Button {
        id: button
        property string symbol: ""
        implicitHeight: 34
        leftPadding: 8
        rightPadding: 8
        font.family: footer.settings.fonts.ui
        font.pixelSize: 12
        enabled: !footer.login.busy
        Accessible.name: text
        ToolTip.visible: hovered
        ToolTip.text: text
        ToolTip.delay: 500
        contentItem: Text {
            text: button.symbol || button.text
            textFormat: Text.PlainText
            font.family: button.font.family
            font.pixelSize: button.symbol ? 19 : 12
            color: footer.settings.colors.foreground
            opacity: button.enabled ? 1 : 0.5
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
        }
        background: Rectangle {
            radius: Math.min(12, footer.settings.appearance.rounding)
            color: footer.settings.colors.selection
            opacity: button.hovered || button.visualFocus ? 0.8 : 0
            border.width: button.visualFocus ? 1 : 0
            border.color: footer.settings.colors.accent
        }
    }

    RowLayout {
        id: buttons
        anchors.fill: parent
        spacing: 8

        ComboBox {
            id: sessionSelector
            objectName: "sessionSelector"
            Layout.preferredWidth: Math.min(220, implicitContentWidth + 40)
            Layout.minimumWidth: 100
            implicitHeight: 34
            model: footer.login.sessions
            textRole: "name"
            currentIndex: footer.login.selectedSession
            enabled: !footer.login.busy
            Accessible.name: qsTr("Desktop session")
            font.family: footer.settings.fonts.ui
            font.pixelSize: 12
            palette.text: footer.settings.colors.foreground
            palette.buttonText: footer.settings.colors.foreground
            palette.window: footer.settings.colors.background
            palette.base: footer.settings.colors.background
            palette.highlight: footer.settings.colors.selection
            palette.highlightedText: footer.settings.colors.selection_foreground
            onActivated: footer.login.selectedSession = currentIndex
            background: null
        }

        Item {
            Layout.fillWidth: true
        }

        ActionButton {
            objectName: "consoleButton"
            text: qsTr("Console login")
            onClicked: consoleHelp.open()
        }
        ActionButton {
            objectName: "suspendButton"
            visible: footer.login.canSuspend
            text: qsTr("Suspend")
            symbol: "☾"
            onClicked: footer.login.suspend()
        }
        ActionButton {
            objectName: "hibernateButton"
            visible: footer.login.canHibernate
            text: qsTr("Hibernate")
            symbol: "Zz"
            onClicked: footer.login.hibernate()
        }
        ActionButton {
            objectName: "rebootButton"
            visible: footer.login.canReboot
            text: qsTr("Restart")
            symbol: "↻"
            onClicked: footer.login.reboot()
        }
        ActionButton {
            objectName: "powerOffButton"
            visible: footer.login.canPowerOff
            text: qsTr("Shut down")
            symbol: "⏻"
            onClicked: footer.login.powerOff()
        }
    }

    property Popup consoleDialog: Popup {
        id: consoleHelp
        objectName: "consoleHelp"
        parent: Overlay.overlay
        anchors.centerIn: parent
        width: Math.min(400, parent.width - 40)
        padding: 24
        modal: true
        focus: true
        closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside
        background: Rectangle {
            color: footer.settings.colors.background
            radius: Math.min(20, footer.settings.appearance.rounding)
            border.width: footer.settings.appearance.border_width
            border.color: footer.settings.colors.muted
        }
        contentItem: ColumnLayout {
            spacing: 16
            Label {
                Layout.fillWidth: true
                text: qsTr("Console login")
                color: footer.settings.colors.bright_foreground
                font.family: footer.settings.fonts.ui
                font.pixelSize: 18
            }
            Label {
                objectName: "consoleInstructions"
                Layout.fillWidth: true
                text: qsTr("Press Ctrl+Alt+F3 to open the system console, then sign in with your normal account.")
                wrapMode: Text.Wrap
                color: footer.settings.colors.foreground
                font.family: footer.settings.fonts.ui
                font.pixelSize: 14
            }
            ActionButton {
                Layout.alignment: Qt.AlignRight
                text: qsTr("Close")
                onClicked: consoleHelp.close()
            }
        }
    }
}
