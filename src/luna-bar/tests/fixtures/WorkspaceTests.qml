import QtQuick
import QtTest
import Quickshell
import "../../src/shell" as Bar
import "../../src/shell/Workspaces.js" as Workspaces

TestCase {
    id: tests
    name: "Workspaces"
    visible: true
    when: windowShown
    width: 400
    height: 50
    property int activated: -1
    property int dismissed: 0
    Bar.WorkspaceStrip {
        id: strip
        theme: ({colors: {accent: "#abcdef", foreground: "#ffffff", selection: "#333333"},
                 fonts: {ui: "Sans"}, appearance: {rounding: 4}})
        workspaceIds: [1, 2, 3, 4, 10]
        activeWorkspace: 10
        onActivated: workspace => tests.activated = workspace
        onDismissed: tests.dismissed++
    }
    function check(actual, expected) {
        try { compare(actual, expected); } catch (error) {
            console.error(qtest_results.functionName + ": actual=" + JSON.stringify(actual) + " expected=" + JSON.stringify(expected));
            throw error;
        }
    }
    function init() {
        activated = -1;
        dismissed = 0;
        strip.activeWorkspace = 10;
        strip.focusActive();
    }
    function cleanupTestCase() {
        console.log("LUNA_BAR_TEST_RESULT " + JSON.stringify({passed: qtest_results.passCount,
            failed: qtest_results.failCount, skipped: qtest_results.skipCount}));
    }
    function test_workspace_list() {
        check(Workspaces.ids([], 1), [1, 2, 3, 4]);
        check(Workspaces.ids([{id: -99}, {id: 10}, {id: 6}, {id: 6}, {id: 2}], 8), [1, 2, 3, 4, 6, 8, 10]);
        check(Workspaces.ids([], -99), [1, 2, 3, 4]);
    }
    function test_keyboard_navigation_activation_and_dismissal() {
        const ten = findChild(strip, "workspace-10");
        tryCompare(ten, "activeFocus", true);
        keyClick(Qt.Key_Right);
        verify(findChild(strip, "workspace-1").activeFocus);
        keyClick(Qt.Key_Tab);
        verify(findChild(strip, "workspace-2").activeFocus);
        keyClick(Qt.Key_Return);
        check(activated, 2);
        keyClick(Qt.Key_Tab, Qt.ShiftModifier);
        keyClick(Qt.Key_Left);
        verify(ten.activeFocus);
        keyClick(Qt.Key_Space);
        check(activated, 10);
        keyClick(Qt.Key_Escape);
        check(dismissed, 1);
    }
    function test_mouse_and_active_state() {
        const two = findChild(strip, "workspace-2");
        mouseClick(two, two.width / 2, two.height / 2);
        check(activated, 2);
        strip.activeWorkspace = 2;
        verify(two.selected);
        verify(!findChild(strip, "workspace-10").selected);
    }
}
