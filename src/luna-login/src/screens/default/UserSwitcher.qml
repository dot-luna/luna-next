pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Effects

Item {
    id: identity
    required property var theme
    required property var login
    property bool compact: false
    property bool switchingEnabled: true
    readonly property bool canPrevious: switchingEnabled && !login.busy && login.selectedUserIndex > 0
    readonly property bool canNext: switchingEnabled && !login.busy && login.users !== null && login.selectedUserIndex < login.users.count - 1
    signal revealRequested
    implicitHeight: avatar.height + 16 + username.implicitHeight

    Connections {
        target: identity.login
        function onSelectedUserChanged() {
            accountFade.restart();
        }
    }
    NumberAnimation {
        id: accountFade
        target: identity
        property: "opacity"
        from: 0.55
        to: 1
        duration: 160
        easing.type: Easing.OutQuad
    }

    function moveUser(direction) {
        if ((direction < 0 && !canPrevious) || (direction > 0 && !canNext))
            return false;
        return login.selectUser(login.selectedUserIndex + direction);
    }

    HoverHandler {
        id: hover
    }

    Button {
        id: avatar
        objectName: "userAvatar"
        anchors.horizontalCenter: parent.horizontalCenter
        width: identity.compact ? 88 : 104
        height: width
        padding: 4
        enabled: !identity.login.busy && identity.login.selectedUser !== ""
        hoverEnabled: true
        Accessible.name: qsTr("Sign in as %1").arg(identity.login.selectedUser)
        onClicked: identity.revealRequested()
        background: Rectangle {
            radius: width / 2
            color: Qt.alpha(identity.theme.colors.lighter_background, avatar.down ? 1 : 0.85)
            border.width: 1
            border.color: avatar.visualFocus ? identity.theme.colors.accent : Qt.alpha(identity.theme.colors.bright_foreground, avatar.hovered ? 0.4 : 0.18)
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
                text: identity.login.selectedUser.charAt(0).toUpperCase()
                color: identity.theme.colors.bright_foreground
                font.family: identity.theme.fonts.ui
                font.pixelSize: 38
                font.weight: Font.Light
            }
            Image {
                id: avatarImage
                objectName: "avatarImage"
                anchors.fill: parent
                source: identity.login.selectedUserIcon
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
        objectName: "userName"
        anchors.top: avatar.bottom
        anchors.topMargin: 16
        width: parent.width
        text: identity.login.selectedUser || qsTr("No users available")
        elide: Text.ElideRight
        horizontalAlignment: Text.AlignHCenter
        color: identity.theme.colors.bright_foreground
        font.family: identity.theme.fonts.ui
        font.pixelSize: 26
        font.weight: Font.Medium
    }

    LoginIconButton {
        objectName: "previousUserButton"
        anchors.right: avatar.left
        anchors.rightMargin: 18
        anchors.verticalCenter: avatar.verticalCenter
        implicitWidth: 42
        implicitHeight: 42
        padding: 10
        opacity: hover.hovered && identity.canPrevious ? 1 : 0
        visible: (hover.hovered && identity.canPrevious) || opacity > 0
        enabled: identity.canPrevious && hover.hovered
        Behavior on opacity {
            NumberAnimation {
                duration: 120
                easing.type: Easing.OutQuad
            }
        }
        theme: identity.theme
        iconName: "arrow-left-01"
        text: qsTr("Previous user")
        onClicked: identity.moveUser(-1)
    }
    LoginIconButton {
        objectName: "nextUserButton"
        anchors.left: avatar.right
        anchors.leftMargin: 18
        anchors.verticalCenter: avatar.verticalCenter
        implicitWidth: 42
        implicitHeight: 42
        padding: 10
        opacity: hover.hovered && identity.canNext ? 1 : 0
        visible: (hover.hovered && identity.canNext) || opacity > 0
        enabled: identity.canNext && hover.hovered
        Behavior on opacity {
            NumberAnimation {
                duration: 120
                easing.type: Easing.OutQuad
            }
        }
        theme: identity.theme
        iconName: "arrow-right-01"
        text: qsTr("Next user")
        onClicked: identity.moveUser(1)
    }
}
