import QtQuick

QtObject {
    property bool canPowerOff: true
    property bool canReboot: true
    property bool canSuspend: true
    property bool canHibernate: false
    property int loginCalls: 0
    property string lastUsername: ""
    property string lastPassword: ""
    property int lastSession: -1
    property string lastPowerAction: ""
    signal loginFailed
    signal loginSucceeded

    function login(username, password, sessionIndex) {
        loginCalls++;
        lastUsername = username;
        lastPassword = password;
        lastSession = sessionIndex;
    }
    function powerOff() {
        lastPowerAction = "powerOff";
    }
    function reboot() {
        lastPowerAction = "reboot";
    }
    function suspend() {
        lastPowerAction = "suspend";
    }
    function hibernate() {
        lastPowerAction = "hibernate";
    }
}
