pragma ComponentBehavior: Bound

import QtQuick
import Quickshell

ShellRoot {
    id: test
    property int step: 0
    function check(condition, message) { if (!condition) throw new Error(message); }
    BackgroundController {
        id: service
        bridgeCommand: JSON.parse(Quickshell.env("LUNA_SETTINGS_TEST_BRIDGE"))
        onFinished: (action, success) => {
            try {
                test.check(!busy, "Request stayed busy");
                if (test.step === 0) {
                    test.check(action === "list" && success && entries.length === 1, "Initial library did not load");
                    test.step++;
                    Qt.callLater(() => service.run("select", "a file #1.png"));
                } else if (test.step === 1) {
                    test.check(action === "select" && success && entries[0].current, "Selection did not publish");
                    test.step++;
                    Qt.callLater(() => service.run("install", "invalid"));
                } else if (test.step === 2) {
                    test.check(!success && errorMessage === "Invalid media" && entries[0].current, "Failure lost the applied wallpaper");
                    test.step++;
                    Qt.callLater(() => service.run("list"));
                } else {
                    test.check(success && errorMessage === "", "Retry failed");
                    console.log("BACKGROUND_CONTROLLER_PASSED");
                    Qt.quit();
                }
            } catch (error) { console.error(error.message); Qt.exit(1); }
        }
    }
    Timer { interval: 5000; running: true; onTriggered: { console.error("Bridge timed out"); Qt.exit(1); } }
}
