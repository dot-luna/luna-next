import QtQuick
import QtTest
import "../theme" as Greeter
import "../rounded-theme" as Rounded
import "../theme/screen" as Screens

TestCase {
    id: test
    visible: true
    name: "LoginScreen"
    when: windowShown
    width: 1920
    height: 1080

    ListModel {
        id: users
        ListElement {
            name: "jrtilak"
            icon: ""
        }
        ListElement {
            name: "alice"
            icon: ""
        }
        ListElement {
            name: "sam"
            icon: ""
        }
    }
    ListModel {
        id: sessions
        ListElement {
            file: "/usr/share/wayland-sessions/hyprland.desktop"
        }
    }
    Component {
        id: main
        Greeter.Main {}
    }
    Component {
        id: roundedMain
        Rounded.Main {}
    }
    Component {
        id: countdown
        Screens.ShutdownView {}
    }
    Component {
        id: proxy
        QtObject {
            property bool canPowerOff: true
            property bool canReboot: true
            property bool canSuspend: true
            property bool canHibernate: false
            property bool canHybridSleep: false
            property var attempt: null
            property string action: ""
            property int powerRequests: 0
            property int attempts: 0
            signal loginFailed
            signal loginSucceeded
            signal informationMessage(string message)
            signal socketDisconnected
            function login(user, password, session) {
                attempts++;
                attempt = {
                    user: user,
                    password: password,
                    session: session
                };
            }
            function powerOff() {
                action = "powerOff";
                powerRequests++;
            }
            function reboot() {
                action = "reboot";
            }
            function suspend() {
                action = "suspend";
            }
            function hibernate() {
                action = "hibernate";
            }
            function hybridSleep() {
                action = "hybridSleep";
            }
        }
    }
    Component {
        id: keyboard
        QtObject {
            property bool enabled: true
            property bool capsLock: false
            property int currentLayout: 0
            property var layouts: [
                {
                    shortName: "en"
                },
                {
                    shortName: "np"
                }
            ]
        }
    }
    property var host: null
    property var field: null
    property var form: null
    property var shutdown: null
    function init() {
        host = createTemporaryObject(main, test, {
            width: 1920,
            height: 1080,
            backend: createTemporaryObject(proxy, test),
            usersModel: users,
            sessionsModel: sessions,
            keyboardState: createTemporaryObject(keyboard, test)
        });
        verify(host !== null);
        tryVerify(() => host.screenItem !== null);
        form = findChild(host, "loginForm");
        field = findChild(host, "passwordInput");
        shutdown = findChild(host, "shutdownView");
        verify(form !== null);
        verify(field !== null);
        verify(shutdown !== null);
        mouseMove(host, 4, 4);
        host.screenItem.forceActiveFocus();
        verify(waitForRendering(host));
    }
    function test_01_resting() {
        compare(form.passwordVisible, false);
        verify(findChild(host, "screenClock").visible);
        verify(findChild(host, "loginActions").visible);
        verify(findChild(host, "clockTime").font.weight >= Font.Medium);
        verify(findChild(host, "userName").font.pixelSize >= 26);
        verify(findChild(host, "powerOffButton").width >= 54);
        compare(findChild(host, "nextUserButton").enabled, false);
    }
    function test_02_password_mode_and_login() {
        const y = form.y;
        keyClick("p");
        compare(form.passwordVisible, true);
        compare(field.text, "p");
        verify(field.activeFocus);
        compare(form.y, y);
        compare(form.scale, 1);
        compare(findChild(host, "screenClock").enabled, false);
        compare(findChild(host, "loginActions").enabled, false);
        compare(findChild(host, "layoutSelector").enabled, false);
        compare(findChild(host, "nextUserButton").enabled, false);
        keyClick("a");
        keyClick("s");
        keyClick("s");
        keyClick(Qt.Key_Return);
        compare(host.backend.attempt.password, "pass");
        compare(host.backend.attempt.user, "jrtilak");
        compare(field.text, "");
        compare(field.canUndo, false);
        host.backend.loginFailed();
        verify(field.activeFocus);
        compare(field.placeholderText, host.login.errorMessage);
        verify(field.Accessible.description.length > 0);
        keyClick("x");
        compare(field.text, "x");
        compare(host.login.errorMessage, "");
    }
    function test_03_escape_returns_to_resting() {
        keyClick("s");
        keyClick("e");
        keyClick("c");
        keyClick(Qt.Key_Escape);
        compare(form.passwordVisible, false);
        compare(field.text, "");
        compare(field.canUndo, false);
        verify(findChild(host, "screenClock").visible);
        verify(findChild(host, "loginActions").visible);
        verify(host.screenItem.activeFocus);
        keyClick("x");
        compare(field.text, "x");
    }
    function test_04_user_arrows_and_boundaries() {
        keyClick(Qt.Key_Left);
        compare(host.login.selectedUser, "jrtilak");
        keyClick(Qt.Key_Right);
        compare(host.login.selectedUser, "alice");
        keyClick(Qt.Key_Right);
        compare(host.login.selectedUser, "sam");
        keyClick(Qt.Key_Right);
        compare(host.login.selectedUser, "sam");
        keyClick(Qt.Key_Left);
        compare(host.login.selectedUser, "alice");
        const avatar = findChild(host, "userAvatar");
        mouseMove(avatar, avatar.width / 2, avatar.height / 2);
        tryCompare(findChild(host, "previousUserButton"), "visible", true);
        tryCompare(findChild(host, "nextUserButton"), "visible", true);
        const next = findChild(host, "nextUserButton");
        mouseClick(next, next.width / 2, next.height / 2);
        compare(host.login.selectedUser, "sam");
        compare(next.enabled, false);
        host.screenItem.forceActiveFocus();
        keyClick("a");
        keyClick(Qt.Key_Left);
        compare(host.login.selectedUser, "sam");
        compare(findChild(host, "previousUserButton").enabled, false);
    }
    function test_05_actions_and_keyboard() {
        verify(findChild(host, "hibernateButton") === null);
        const sleep = findChild(host, "suspendButton");
        mouseClick(sleep, sleep.width / 2, sleep.height / 2);
        compare(host.backend.action, "suspend");
        const avatar = findChild(host, "userAvatar");
        mouseClick(avatar, avatar.width / 2, avatar.height / 2);
        verify(field.activeFocus);
        keyClick("s");
        host.keyboardState.currentLayout = 1;
        compare(field.text, "");
        compare(field.canUndo, false);
        verify(field.activeFocus);
        host.keyboardState.capsLock = true;
        verify(field.placeholderText.indexOf("Caps Lock") >= 0);
    }
    function test_06_shutdown_and_escape() {
        const power = findChild(host, "powerOffButton");
        mouseClick(power, power.width / 2, power.height / 2);
        compare(shutdown.active, true);
        compare(shutdown.remainingSeconds, 3);
        compare(form.enabled, false);
        compare(findChild(host, "screenClock").enabled, false);
        compare(findChild(host, "loginActions").enabled, false);
        verify(waitForRendering(shutdown));
        keyClick(Qt.Key_Escape);
        compare(shutdown.active, false);
        compare(host.backend.powerRequests, 0);
        verify(findChild(host, "screenClock").visible);
        wait(3200);
        compare(host.backend.powerRequests, 0);
    }
    function test_07_shutdown_mouse_cancel() {
        verify(shutdown.start());
        const cancel = findChild(host, "cancelShutdownButton");
        mouseClick(cancel, cancel.width / 2, cancel.height / 2);
        compare(shutdown.active, false);
        compare(host.backend.powerRequests, 0);
    }
    function test_08_shutdown_expires_once() {
        verify(shutdown.start());
        tryCompare(host.backend, "powerRequests", 1, 4200);
        compare(shutdown.committed, true);
        compare(findChild(host, "shutdownMessage").text, "Shutting down…");
        keyClick(Qt.Key_Escape);
        compare(shutdown.active, true);
        wait(200);
        compare(host.backend.powerRequests, 1);
    }
    function test_09_unavailable_shutdown() {
        verify(shutdown.start());
        host.backend.canPowerOff = false;
        shutdown.deadline = Date.now() - 1;
        tryVerify(() => shutdown.errorMessage !== "");
        compare(host.backend.powerRequests, 0);
        verify(shutdown.cancel());
        compare(shutdown.start(), false);
    }
    function test_10_configurable_delay() {
        const shortCountdown = createTemporaryObject(countdown, test, {
            theme: host.settings.theme,
            login: host.login,
            delaySeconds: 1,
            width: 1280,
            height: 720
        });
        verify(shortCountdown.start());
        compare(shortCountdown.remainingSeconds, 1);
        tryCompare(host.backend, "powerRequests", 1, 1800);
        const instant = createTemporaryObject(countdown, test, {
            theme: host.settings.theme,
            login: host.login,
            delaySeconds: 0
        });
        verify(instant.start());
        compare(host.backend.powerRequests, 2);
    }
    function test_11_appearance_and_sizes() {
        const rounded = createTemporaryObject(roundedMain, test, {
            width: 1280,
            height: 720,
            backend: createTemporaryObject(proxy, test),
            usersModel: users,
            sessionsModel: sessions,
            keyboardState: createTemporaryObject(keyboard, test)
        });
        tryVerify(() => rounded.screenItem !== null);
        compare(findChild(rounded, "passwordInput").background.radius, 18);
        compare(findChild(rounded, "clockTime").font.family, "serif");
        compare(findChild(rounded, "backgroundEffect").blurEnabled, false);
        rounded.visible = false;
        for (const size of [[1280, 720], [1920, 1080], [2560, 1440], [3440, 1440]]) {
            host.width = size[0];
            host.height = size[1];
            wait(20);
            verify(Math.abs(form.y + form.height / 2 - size[1] / 2) < 2);
            const avatar = findChild(host, "userAvatar");
            const point = avatar.mapToItem(host, 0, 0);
            verify(Math.abs(point.x + avatar.width / 2 - size[0] / 2) < 2);
            form.revealPassword("");
            const p = field.mapToItem(host, 0, 0);
            verify(p.y + field.height < size[1] - 70);
            form.dismiss();
        }
    }

    function test_12_fades_do_not_delay_input_or_restore_secrets() {
        keyClick("a");
        verify(field.activeFocus);
        compare(field.text, "a");
        keyClick("b");
        keyClick(Qt.Key_Escape);
        compare(field.text, "");
        compare(field.canUndo, false);
        verify(host.screenItem.activeFocus);
        keyClick("c");
        verify(field.activeFocus);
        compare(field.text, "c");
        tryCompare(field, "opacity", 1);
        compare(form.scale, 1);
        form.dismiss();
        tryCompare(field, "visible", false);
        tryCompare(findChild(host, "screenClock"), "opacity", 1);
    }
    function test_13_success_fades_only_after_backend_confirmation() {
        tryCompare(host.screenItem, "opacity", 1);
        keyClick("p");
        keyClick(Qt.Key_Return);
        compare(host.backend.attempts, 1);
        compare(host.screenItem.opacity, 1);
        verify(host.login.busy);
        compare(field.text, "");
        keyClick(Qt.Key_Return);
        compare(host.backend.attempts, 1);
        host.backend.loginFailed();
        verify(field.activeFocus);
        compare(host.screenItem.opacity, 1);
        keyClick("r");
        keyClick(Qt.Key_Return);
        compare(host.backend.attempts, 2);
        compare(host.screenItem.opacity, 1);
        host.backend.loginSucceeded();
        verify(host.login.authenticated);
        verify(host.login.busy);
        compare(host.screenItem.enabled, false);
        compare(field.text, "");
        tryCompare(host.screenItem, "opacity", 0);
        host.backend.socketDisconnected();
        compare(host.login.disconnected, false);
        compare(host.screenItem.opacity, 0);
    }
    function test_14_fixed_session_and_disconnection() {
        compare(host.login.selectedSession, 0);
        compare(host.login.selectUser(-1), false);
        compare(host.login.selectUser(3), false);
        keyClick("x");
        keyClick(Qt.Key_Return);
        compare(host.backend.attempt.session, 0);
        host.backend.socketDisconnected();
        compare(host.login.busy, false);
        verify(field.activeFocus);
        verify(host.login.errorMessage.indexOf("Ctrl+Alt+F6") >= 0);
        compare(host.login.requestAction("powerOff"), false);
        keyClick("x");
        keyClick(Qt.Key_Return);
        compare(host.backend.attempts, 1);
    }

    function test_15_keyboard_and_mouse_activation_during_transitions() {
        const cancel = findChild(host, "cancelShutdownButton");
        verify(shutdown.start());
        host.screenItem.forceActiveFocus();
        keyClick(Qt.Key_Tab);
        verify(cancel.activeFocus);
        keyClick(Qt.Key_Space);
        compare(shutdown.active, false);
        compare(host.backend.powerRequests, 0);
        keyClick("x");
        verify(field.activeFocus);
        const submit = findChild(host, "loginButton");
        mouseClick(submit, submit.width / 2, submit.height / 2);
        compare(host.backend.attempts, 1);
        compare(host.backend.attempt.password, "x");
    }
}
