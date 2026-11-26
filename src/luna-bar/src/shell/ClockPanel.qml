pragma ComponentBehavior: Bound
import QtQuick
import Quickshell
import Quickshell.Io

// Local time and date, then configured world clocks.
Item {
    id: panel
    required property var theme
    /** Resolved clock settings: time_format, date_format and world [{name, timezone}]. */
    required property var clock
    property bool active: false

    implicitWidth: 184
    implicitHeight: column.implicitHeight + 2 * 16

    // QML dates are local only, so each zone's UTC offset comes from `date`. Refresh on open and
    // periodically while open, so daylight-saving changes apply without a restart.
    signal refresh()
    onActiveChanged: if (active) refresh()
    Component.onCompleted: if (active) refresh()
    Timer {
        interval: 15 * 60 * 1000
        repeat: true
        running: panel.active
        onTriggered: panel.refresh()
    }
    SystemClock {
        id: time
        enabled: panel.active
        precision: SystemClock.Minutes
    }

    Column {
        id: column
        x: 18
        y: 16
        width: panel.width - 36
        spacing: 14

        Column {
            width: parent.width
            spacing: 2
            Text {
                objectName: "localTime"
                text: Qt.formatDateTime(time.date, panel.clock.time_format)
                color: panel.theme.colors.foreground
                font.family: panel.theme.fonts.ui
                font.pixelSize: 32
                font.weight: Font.Light
            }
            Text {
                text: Qt.formatDateTime(time.date, panel.clock.date_format)
                color: panel.theme.colors.foreground
                opacity: 0.7
                font.family: panel.theme.fonts.ui
                font.pixelSize: 13
            }
        }

        Column {
            width: parent.width
            spacing: 10
            visible: zones.count > 0
            Repeater {
                id: zones
                model: panel.clock.world
                delegate: Item {
                    id: zone
                    required property var modelData
                    // Minutes east of UTC; null until `date` answers.
                    property var offset: null
                    readonly property date local: {
                        if (offset === null) return time.date;
                        const now = time.date;
                        return new Date(now.getTime() + (offset + now.getTimezoneOffset()) * 60000);
                    }
                    Connections {
                        target: panel
                        function onRefresh() { query.running = true; }
                    }
                    objectName: "worldClock-" + modelData.name
                    width: parent.width
                    height: 34

                    Process {
                        id: query
                        command: ["date", "+%z"]
                        // qmllint disable incompatible-type
                        environment: ({TZ: zone.modelData.timezone})
                        // qmllint enable incompatible-type
                        stdout: StdioCollector {
                            onStreamFinished: {
                                const match = /^([+-])(\d\d)(\d\d)$/.exec(text.trim());
                                if (match) zone.offset = (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
                            }
                        }
                    }
                    Text {
                        anchors.left: parent.left
                        anchors.top: parent.top
                        text: zone.modelData.name
                        color: panel.theme.colors.foreground
                        font.family: panel.theme.fonts.ui
                        font.pixelSize: 13
                        font.bold: true
                    }
                    Text {
                        anchors.left: parent.left
                        anchors.bottom: parent.bottom
                        text: zone.offset === null ? "" : Qt.formatDateTime(zone.local, panel.clock.date_format)
                        color: panel.theme.colors.foreground
                        opacity: 0.6
                        font.family: panel.theme.fonts.ui
                        font.pixelSize: 12
                    }
                    Text {
                        anchors.right: parent.right
                        anchors.verticalCenter: parent.verticalCenter
                        text: zone.offset === null ? "" : Qt.formatDateTime(zone.local, panel.clock.time_format)
                        color: panel.theme.colors.foreground
                        font.family: panel.theme.fonts.ui
                        font.pixelSize: 17
                    }
                }
            }
        }
    }
}
