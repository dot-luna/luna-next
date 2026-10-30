import QtQuick
import QtTest
import "../bundle" as Bundle

Item {
    id: scene
    width: 1280
    height: 720

    Component {
        id: greeterComponent
        Bundle.Main {}
    }
    Component {
        id: backendComponent
        MockBackend {}
    }
    Component {
        id: backgroundComponent
        Bundle.Background {}
    }

    ListModel {
        id: users
        property string lastUser: "luna"
        property int lastIndex: 0
        ListElement {
            name: "luna"
            realName: "Luna"
            icon: ""
        }
        ListElement {
            name: "guest"
            realName: "Guest"
            icon: "../assets/image.png"
        }
    }
    ListModel {
        id: sessions
        property int lastIndex: 1
        ListElement {
            name: "Desktop"
        }
        ListElement {
            name: "Hyprland"
        }
    }
    QtObject {
        id: keyboardState
        property bool capsLock: false
    }

    TestCase {
        id: tests
        name: "LunaLogin"
        when: windowShown
        property var greeter
        property var backend

        function init() {
            backend = createTemporaryObject(backendComponent, scene);
            verify(backend !== null);
            greeter = createTemporaryObject(greeterComponent, scene, {
                backend: backend,
                usersModel: users,
                sessionsModel: sessions,
                keyboardState: keyboardState
            });
            verify(greeter !== null);
            tryVerify(() => greeter.screenItem !== null);
            compare(findChild(greeter, "screenLoader").status, Loader.Ready);
        }

        function cleanup() {
            keyboardState.capsLock = false;
        }

        function revealLogin() {
            greeter.screenItem.forceActiveFocus();
            keyClick(Qt.Key_Space);
            compare(greeter.screenItem.loginVisible, true);
            tryCompare(findChild(greeter, "loginForm"), "opacity", 1);
        }

        function test_welcome_reveal_typing_and_escape() {
            compare(greeter.screenItem.loginVisible, false);
            compare(findChild(greeter, "welcomePrompt").visible, true);
            verify(findChild(greeter, "clockText").text.length > 0);
            verify(findChild(greeter, "dateText").text.length > 0);
            greeter.screenItem.forceActiveFocus();
            keyClick(Qt.Key_Return);
            compare(greeter.screenItem.loginVisible, true);
            tryCompare(findChild(greeter, "loginForm"), "opacity", 1);
            compare(backend.loginCalls, 0);
            const password = findChild(greeter, "passwordInput");
            compare(password.text, "");
            password.forceActiveFocus();
            keyClick(Qt.Key_A);
            compare(password.text, "a");
            keyClick(Qt.Key_Escape);
            compare(greeter.screenItem.loginVisible, false);
            compare(password.text, "");
            compare(password.canUndo, false);
            compare(greeter.login.errorMessage, "");
            revealLogin();
            compare(password.text, "");
        }

        function test_settings_and_models() {
            revealLogin();
            compare(greeter.screenItem.settings.colors.accent, "#7aa2f7");
            compare(greeter.screenItem.settings.fonts.ui, "sans-serif");
            compare(greeter.screenItem.login, greeter.login);
            compare(greeter.login.selectedUser, "luna");
            compare(greeter.login.selectedSession, 1);
            compare(findChild(greeter, "userSelector").editText, "luna");
            compare(findChild(greeter, "sessionSelector").currentIndex, 1);
            keyboardState.capsLock = true;
            compare(greeter.login.capsLock, true);
            compare(findChild(greeter, "capsLockWarning").visible, true);
        }

        function test_avatar_and_power_capabilities() {
            revealLogin();
            const image = findChild(greeter, "avatarImage");
            compare(image.visible, false);
            const user = findChild(greeter, "userSelector");
            user.currentIndex = 1;
            user.editText = "guest";
            tryCompare(image, "status", Image.Ready);
            compare(image.visible, true);
            compare(findChild(greeter, "hibernateButton").visible, false);
            backend.canHibernate = true;
            compare(findChild(greeter, "hibernateButton").visible, true);
            findChild(greeter, "suspendButton").clicked();
            compare(backend.lastPowerAction, "suspend");
            findChild(greeter, "consoleButton").clicked();
            tryCompare(findChild(greeter, "consoleHelp"), "opened", true);
            verify(findChild(greeter, "consoleInstructions").text.indexOf("Ctrl+Alt+F3") >= 0);
        }

        function test_typed_username_reaches_sddm() {
            revealLogin();
            const selector = findChild(greeter, "userSelector");
            const editor = selector.contentItem;
            editor.forceActiveFocus();
            editor.selectAll();
            keyClick(Qt.Key_O);
            keyClick(Qt.Key_T);
            keyClick(Qt.Key_H);
            keyClick(Qt.Key_E);
            keyClick(Qt.Key_R);
            compare(selector.editText, "other");
            keyClick(Qt.Key_Return);
            const password = findChild(greeter, "passwordInput");
            tryCompare(password, "activeFocus", true);
            password.insert(0, "test secret");
            keyClick(Qt.Key_Return);
            compare(backend.loginCalls, 1);
            compare(backend.lastUsername, "other");
            compare(backend.lastPassword, "test secret");
        }

        function test_theme_blur_contract() {
            const settings = JSON.parse(JSON.stringify(greeter.settings));
            settings.appearance.blur = {
                enabled: true,
                size: 12,
                passes: 2
            };
            greeter.screenItem.settings = settings;
            const background = findChild(greeter, "screenBackground");
            compare(background.layer.enabled, true);
            verify(background.layer.effect !== null);
            fuzzyCompare(findChild(greeter, "backgroundShade").opacity, 0.1, 0.0001);
        }

        function test_password_enter_busy_failure_retry() {
            revealLogin();
            const password = findChild(greeter, "passwordInput");
            password.forceActiveFocus();
            password.insert(0, "temporary test password");
            keyClick(Qt.Key_Return);
            compare(backend.loginCalls, 1);
            compare(backend.lastUsername, "luna");
            compare(backend.lastPassword, "temporary test password");
            compare(backend.lastSession, 1);
            compare(password.text, "");
            compare(password.canUndo, false);
            compare(greeter.login.busy, true);
            compare(findChild(greeter, "loginButton").enabled, false);
            verify(!greeter.login.submit("luna", "second attempt", 1));
            compare(backend.loginCalls, 1);
            backend.loginFailed();
            compare(greeter.login.busy, false);
            verify(greeter.login.errorMessage.length > 0);
            compare(password.text, "");
            verify(greeter.login.submit("guest", "", 0));
            compare(backend.lastUsername, "guest");
            compare(backend.lastSession, 0);
            backend.loginSucceeded();
            compare(greeter.login.errorMessage, "");
            compare(greeter.login.busy, true);
        }

        function test_validation_and_capability_checks() {
            verify(!greeter.login.submit("  ", "", 0));
            verify(!greeter.login.submit("luna", "", -1));
            compare(backend.loginCalls, 0);
            greeter.login.hibernate();
            compare(backend.lastPowerAction, "");
            greeter.login.reboot();
            compare(backend.lastPowerAction, "reboot");
            backend.canPowerOff = false;
            greeter.login.powerOff();
            compare(backend.lastPowerAction, "reboot");
            verify(greeter.login.submit("luna", "", 0));
            greeter.login.suspend();
            compare(backend.lastPowerAction, "reboot");
        }

        function test_image_and_animated_image() {
            for (const source of ["assets/image.png", "assets/animated.gif"]) {
                const background = createTemporaryObject(backgroundComponent, scene, {
                    wallpaper: {
                        source: source,
                        type: "image",
                        fit: "fit",
                        background_color: "#000000"
                    },
                    width: 100,
                    height: 100
                });
                verify(background !== null);
                const image = findChild(background, "backgroundImage");
                tryCompare(image, "status", Image.Ready);
                compare(image.fillMode, Image.PreserveAspectFit);
                if (source.endsWith(".gif")) {
                    verify(image.frameCount > 1);
                    verify(image.playing);
                    const frame = image.currentFrame;
                    tryVerify(() => image.currentFrame !== frame);
                }
                compare(findChild(background, "videoLoader").active, false);
            }
        }
    }
}
