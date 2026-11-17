pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Io

// A list delegate owns its decode process and releases the image when the row is discarded.
Item {
    id: attachment
    required property string entryId
    property var preview: ({})
    readonly property string label: preview.name || ""
    readonly property bool ready: thumbnail.status === Image.Ready

    Image {
        id: thumbnail
        objectName: "clipboardThumbnail"
        anchors.fill: parent
        source: attachment.preview.image || ""
        sourceSize: Qt.size(192, 128)
        fillMode: Image.PreserveAspectFit
        asynchronous: true
        cache: false
    }
    Process {
        id: decode
        command: [Quickshell.env("HOME") + "/.local/bin/luna", "clipboard", "preview", attachment.entryId, "--json"]
        running: true
        stdout: StdioCollector { id: output }
        onExited: (code, status) => {
            if (code !== 0 || status !== 0) return;
            try {
                const response = JSON.parse(output.text);
                if (response.succes) attachment.preview = response.data;
            } catch (error) {
                // Keep the list's type/size label if this entry disappeared during decoding.
            }
        }
    }
}
