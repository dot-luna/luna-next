pragma ComponentBehavior: Bound
import QtQuick

Column {
    id: page
    required property var theme
    required property var audio
    property bool input: false
    readonly property var devices: input ? audio.inputs : audio.outputs
    readonly property var streams: input ? audio.recording : audio.playback
    signal back()
    spacing: 8
    PageHeader {
        width: parent.width
        theme: page.theme
        title: page.input ? "Microphone" : "Sound"
        onBack: page.back()
    }
    Repeater {
        model: page.devices
        ListRow {
            required property var modelData
            width: page.width
            theme: page.theme
            iconName: page.input ? "mic-01" : "speaker"
            label: page.audio.label(modelData)
            selected: modelData === (page.input ? page.audio.input : page.audio.output)
            trailing: selected ? "tick-02" : ""
            enabled: !page.audio.selecting
            onClicked: page.audio.select(modelData, page.input)
        }
    }
    PanelText {
        width: parent.width
        theme: page.theme
        visible: !page.devices.length
        text: "No devices"
        opacity: 0.6
    }
    PanelText {
        theme: page.theme
        visible: page.streams.length > 0
        text: "Apps"
        font.bold: true
    }
    Repeater {
        model: page.streams
        Column {
            id: app
            required property var modelData
            width: page.width
            spacing: 2
            PanelText {
                width: parent.width
                theme: page.theme
                text: page.audio.label(app.modelData)
                elide: Text.ElideRight
                maximumLineCount: 1
            }
            ControlSlider {
                width: parent.width
                theme: page.theme
                label: page.audio.label(app.modelData)
                iconName: page.input ? "mic-01" : "volume-high"
                value: app.modelData.audio.volume
                iconClickable: true
                onMoved: value => app.modelData.audio.volume = value
                onIconClicked: app.modelData.audio.muted = !app.modelData.audio.muted
                opacity: app.modelData.audio.muted ? 0.5 : 1
            }
        }
    }
    PanelText {
        width: parent.width
        theme: page.theme
        text: page.audio.error
        visible: text !== ""
    }
}
