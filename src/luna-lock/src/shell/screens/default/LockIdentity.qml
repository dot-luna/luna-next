pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Effects

Item {
    id: identity
    required property var lock
    property bool compact: false
    signal revealRequested
    implicitHeight: avatar.height + 16 + username.implicitHeight

    Button {
        id: avatar
        objectName: "lock-avatar"
        anchors.horizontalCenter: parent.horizontalCenter
        width: identity.compact ? 88 : 104
        height: width
        padding: 4
        hoverEnabled: true
        Accessible.name: qsTr("Unlock as %1").arg(identity.lock.username)
        onClicked: {
            identity.lock.activity();
            identity.revealRequested();
        }
        background: Rectangle {
            radius: width / 2
            color: Qt.alpha(identity.lock.theme.colors.lighter_background, avatar.down ? 1 : 0.85)
            border.width: 1
            border.color: avatar.visualFocus ? identity.lock.theme.colors.accent : Qt.alpha(identity.lock.theme.colors.bright_foreground, avatar.hovered ? 0.4 : 0.18)
            Behavior on border.color {
                ColorAnimation {
                    duration: 140
                }
            }
            Behavior on color {
                ColorAnimation {
                    duration: 110
                }
            }
        }
        contentItem: Item {
            Rectangle {
                id: mask
                anchors.fill: parent
                radius: width / 2
                color: "white"
                visible: false
                layer.enabled: true
            }
            Text {
                anchors.centerIn: parent
                visible: avatarImage.status !== Image.Ready
                text: identity.lock.username.charAt(0).toUpperCase()
                color: identity.lock.theme.colors.bright_foreground
                font.family: identity.lock.theme.fonts.ui
                font.pixelSize: 38
                font.weight: Font.Light
            }
            Image {
                id: avatarImage
                anchors.fill: parent
                source: identity.lock.userIcon
                fillMode: Image.PreserveAspectCrop
                asynchronous: true
                visible: status === Image.Ready
                layer.enabled: true
                layer.effect: MultiEffect {
                    maskEnabled: true
                    maskSource: mask
                }
            }
        }
    }

    Text {
        id: username
        objectName: "lock-username"
        anchors.top: avatar.bottom
        anchors.topMargin: 16
        width: parent.width
        text: identity.lock.username
        elide: Text.ElideRight
        horizontalAlignment: Text.AlignHCenter
        color: identity.lock.theme.colors.bright_foreground
        font.family: identity.lock.theme.fonts.ui
        font.pixelSize: 26
        font.weight: Font.Medium
    }
}
