pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic

// An icon (which may act as a button, such as mute), a slider, and an optional page chevron.
Item {
    id: row
    required property var theme
    required property string iconName
    required property string label
    property real value: 0
    property bool hasMore: false
    property bool iconClickable: false
    signal moved(real value)
    signal iconClicked()
    signal more()

    implicitHeight: 28

    IconButton {
        id: lead
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
        theme: row.theme
        iconName: row.iconName
        enabled: row.iconClickable
        Accessible.name: "Mute " + row.label
        opacity: 1
        onClicked: row.iconClicked()
    }
    Slider {
        id: slider
        anchors.left: lead.right
        anchors.leftMargin: 6
        anchors.right: chevron.left
        anchors.rightMargin: 6
        anchors.verticalCenter: parent.verticalCenter
        from: 0
        to: 1
        value: row.value
        Accessible.name: row.label
        focusPolicy: Qt.StrongFocus
        onMoved: row.moved(value)
        background: Item {
            x: slider.leftPadding
            y: slider.topPadding + slider.availableHeight / 2 - 2
            width: slider.availableWidth
            height: 4
            Rectangle {
                anchors.fill: parent
                radius: Math.min(row.theme.appearance.rounding, 2)
                color: row.theme.colors.muted
            }
            Rectangle {
                width: slider.visualPosition * parent.width
                height: parent.height
                radius: Math.min(row.theme.appearance.rounding, 2)
                color: row.theme.colors.accent
            }
        }
        handle: Rectangle {
            x: slider.leftPadding + slider.visualPosition * (slider.availableWidth - width)
            y: slider.topPadding + slider.availableHeight / 2 - height / 2
            width: slider.pressed ? 14 : 12
            height: width
            radius: width / 2
            color: row.theme.colors.foreground
            border.width: slider.visualFocus ? 2 : 0
            border.color: row.theme.colors.accent
            Behavior on width { NumberAnimation { duration: 100 } }
        }
    }
    IconButton {
        id: chevron
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        theme: row.theme
        iconName: "arrow-right-01"
        size: row.hasMore ? 24 : 0
        visible: row.hasMore
        Accessible.name: row.label + " settings"
        onClicked: row.more()
    }
}
