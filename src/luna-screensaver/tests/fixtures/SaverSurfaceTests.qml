import QtQuick
import QtTest
import Quickshell
import "../../src/shell" as Saver

TestCase {
    id: tests
    name: "SaverSurface"
    visible: true
    property var surface
    property var input
    property var pointer
    property int dismissed: 0
    property var failedTests: []
    readonly property var theme: JSON.parse(Quickshell.env("LUNA_SCREENSAVER_THEME"))
    readonly property date fixedDate: new Date(2026, 10, 3, 14, 25)

    Component {
        id: surfaceComponent
        Saver.SaverSurface {}
    }

    function check(actual, expected, message) {
        try {
            compare(actual, expected, message);
        } catch (error) {
            console.error(qtest_results.functionName + ": " + (message || "")
                + " actual=" + JSON.stringify(actual) + " expected=" + JSON.stringify(expected));
            throw error;
        }
    }

    function init() {
        surface = createTemporaryObject(surfaceComponent, null, {theme: theme,
            dateTime: fixedDate, keyboardActive: true});
        verify(surface !== null);
        input = findChild(surface.contentItem, "screensaver-input");
        pointer = findChild(surface.contentItem, "screensaver-pointer");
        verify(input !== null);
        verify(pointer !== null);
        dismissed = 0;
        surface.dismissed.connect(function () { dismissed++; surface.showing = false; });
    }

    function show() {
        surface.showing = true;
        tryCompare(surface, "visible", true);
        input.forceActiveFocus();
        tryCompare(input, "activeFocus", true);
        verify(waitForRendering(input));
    }

    function cleanup() {
        if (qtest_results.failed)
            failedTests = failedTests.concat([qtest_results.functionName]);
    }

    function cleanupTestCase() {
        console.log("LUNA_SCREENSAVER_TEST_RESULT " + JSON.stringify({passed: qtest_results.passCount,
            failed: qtest_results.failCount, skipped: qtest_results.skipCount, failedTests: failedTests}));
    }

    function test_starts_hidden_and_clock_uses_current_theme_and_date() {
        compare(surface.visible, false);
        compare(String(surface.color), theme.colors.background);
        const brand = findChild(input, "screensaver-brand");
        const clock = findChild(input, "screensaver-clock");
        const date = findChild(input, "screensaver-date");
        compare(brand.text, "Luna");
        compare(String(brand.color), theme.colors.accent);
        compare(clock.text, Qt.formatTime(fixedDate, Qt.locale().timeFormat(Locale.ShortFormat)));
        compare(String(clock.color), theme.colors.bright_foreground);
        compare(clock.font.family, theme.fonts.ui);
        compare(date.text, Qt.formatDate(fixedDate, "dddd, d MMMM"));
        compare(String(date.color), theme.colors.foreground);
        surface.dateTime = new Date(2026, 10, 4, 15, 10);
        compare(clock.text, Qt.formatTime(surface.dateTime, Qt.locale().timeFormat(Locale.ShortFormat)));
        compare(date.text, Qt.formatDate(surface.dateTime, "dddd, d MMMM"));
    }

    function test_keyboard_dismisses_before_pointer_guard_expires() {
        show();
        compare(surface.movementReady, false);
        keyClick(Qt.Key_Escape);
        compare(dismissed, 1);
        compare(surface.visible, false);
    }

    function test_click_dismisses_before_pointer_guard_expires() {
        show();
        compare(surface.movementReady, false);
        mouseClick(pointer, 5, 5, Qt.LeftButton);
        compare(dismissed, 1);
        compare(surface.visible, false);
    }

    function test_wheel_dismisses_before_pointer_guard_expires() {
        show();
        compare(surface.movementReady, false);
        mouseWheel(pointer, 50, 50, 0, 120);
        compare(dismissed, 1);
        compare(surface.visible, false);
    }

    function test_pointer_movement_waits_only_for_startup_guard_and_resets_each_show() {
        show();
        mouseMove(pointer, 20, 20);
        compare(dismissed, 0);
        compare(surface.visible, true);
        tryCompare(surface, "movementReady", true, 1000);
        mouseMove(pointer, 40, 40);
        compare(dismissed, 1);
        compare(surface.visible, false);
        show();
        compare(surface.movementReady, false);
        mouseMove(pointer, 60, 60);
        compare(dismissed, 1);
        keyClick(Qt.Key_A);
        compare(dismissed, 2);
    }
}
