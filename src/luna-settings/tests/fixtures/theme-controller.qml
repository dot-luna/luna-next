pragma ComponentBehavior: Bound
import QtQuick
import Quickshell

ShellRoot {
    id: test
    property int step: 0
    function check(condition, message) { if (!condition) throw new Error(message); }
    ThemeController {
        id: service
        bridgeCommand: JSON.parse(Quickshell.env("LUNA_SETTINGS_TEST_BRIDGE"))
        onFinished: (action, success) => {
            try {
                test.check(!busy, "Request stayed busy");
                if (test.step === 0) {
                    test.check(action === "list" && success && entries.length === 1, "Library did not load");
                    test.step++;
                    Qt.callLater(() => service.run("preview", "https://example.com/a file.jsonc"));
                } else if (test.step === 1) {
                    test.check(action === "preview" && success && preview.suggestedName === "custom" && entries.length === 1, "Info replaced the gallery");
                    test.step++;
                    Qt.callLater(() => service.run("install", "https://example.com/a file.jsonc", "custom", preview.fingerprint));
                } else if (test.step === 2) {
                    test.check(action === "install" && success && entries.length === 2, "Import did not publish");
                    test.step++;
                    Qt.callLater(() => service.run("select", "invalid"));
                } else if (test.step === 3) {
                    test.check(!success && errorMessage === "Invalid theme" && entries.length === 2, "Failure lost the gallery");
                    test.step++;
                    Qt.callLater(() => service.run("list"));
                } else {
                    test.check(success && errorMessage === "", "Retry failed");
                    console.log("THEME_CONTROLLER_PASSED");
                    Qt.quit();
                }
            } catch (error) { console.error(error.message); Qt.exit(1); }
        }
    }
    Timer { interval: 5000; running: true; onTriggered: { console.error("Bridge timed out"); Qt.exit(1); } }
}
