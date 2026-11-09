pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic

Switch {
    id: control
    implicitWidth: 46
    implicitHeight: 32
    padding: 0
    hoverEnabled: true
    indicator: Rectangle {
        x: 0; y: 3; width: 46; height: 26; radius: 13
        color: control.checked ? control.palette.highlight : control.palette.mid
        border.width: control.visualFocus ? 2 : 0
        border.color: control.palette.text
        Behavior on color { ColorAnimation { duration: 120 } }
        Rectangle {
            x: control.checked ? 23 : 3
            y: 3; width: 20; height: 20; radius: 10
            color: control.checked ? control.palette.highlightedText : control.palette.text
            Behavior on x { NumberAnimation { duration: 120; easing.type: Easing.OutCubic } }
        }
    }
}
