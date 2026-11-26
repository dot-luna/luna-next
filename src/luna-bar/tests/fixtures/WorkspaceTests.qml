import QtQuick
import QtTest
import Quickshell
import "../../src/shell" as Bar
import "../../src/shell/Workspaces.js" as Workspaces
import "../../src/shell/BikramSambat.js" as BikramSambat

TestCase {
    id: tests
    name: "Workspaces"
    visible: true
    when: windowShown
    width: 400
    height: 300
    property int activated: -1
    property int dismissed: 0
    property int leftDirection: 0
    readonly property var theme: ({
        colors: {accent: "#abcdef", accent_foreground: "#000000", background: "#111111",
                 foreground: "#ffffff", bright_foreground: "#ffffff", muted: "#333333"},
        fonts: {ui: "Sans"}, appearance: {rounding: 4, border_width: 1, opacity: {active: 1}}})
    Bar.WorkspaceStrip {
        id: strip
        theme: tests.theme
        workspaceIds: [1, 2, 3, 4, 10]
        activeWorkspace: 10
        visibleCount: 10
        icons: ({"10": Qt.resolvedUrl("../../src/shell/icons/bot.svg").toString().replace(/^file:\/\//, "")})
        onActivated: workspace => tests.activated = workspace
        onDismissed: tests.dismissed++
        onLeaving: direction => tests.leftDirection = direction
    }
    Bar.CalendarView {
        id: calendar
        y: 40
        theme: tests.theme
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
        leftDirection = 0;
        strip.visibleCount = 10;
        strip.workspaceIds = [1, 2, 3, 4, 10];
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
    function test_tab_leaves_at_the_ends() {
        keyClick(Qt.Key_Tab);
        check(leftDirection, 1);
        findChild(strip, "workspace-1").forceActiveFocus();
        keyClick(Qt.Key_Tab, Qt.ShiftModifier);
        check(leftDirection, -1);
    }
    function test_mouse_and_active_state() {
        const two = findChild(strip, "workspace-2");
        mouseClick(two, two.width / 2, two.height / 2);
        check(activated, 2);
        strip.activeWorkspace = 2;
        verify(two.selected);
        verify(!findChild(strip, "workspace-10").selected);
    }
    function test_viewport_keeps_the_selection_visible() {
        strip.workspaceIds = [1, 2, 3, 4, 6, 8, 10];
        strip.visibleCount = 4;
        strip.activeWorkspace = 10;
        tryCompare(strip, "first", 3);
        strip.activeWorkspace = 1;
        tryCompare(strip, "first", 0);
        // Keyboard focus reveals hidden slots without switching workspace.
        findChild(strip, "workspace-1").forceActiveFocus();
        keyClick(Qt.Key_Left);
        verify(findChild(strip, "workspace-10").activeFocus);
        tryCompare(strip, "first", 3);
        check(activated, -1);
    }
    function test_calendar_changes_month_and_returns_to_today() {
        calendar.mode = "ad";
        calendar.reset();
        calendar.forceActiveFocus();
        const month = calendar.adMonth;
        keyClick(Qt.Key_Right);
        check((calendar.adMonth - month + 12) % 12, 1);
        keyClick(Qt.Key_Left);
        keyClick(Qt.Key_Left);
        check((month - calendar.adMonth + 12) % 12, 1);
        mouseClick(findChild(calendar, "nextMonth"));
        mouseClick(findChild(calendar, "calendarTitle"));
        check(calendar.adMonth, month);
        keyClick(Qt.Key_Escape);
        check(dismissed, 1);
    }
    function test_bikram_sambat_conversion_and_switch() {
        check(BikramSambat.fromAd(new Date(1943, 3, 14)), {year: 2000, month: 1, day: 1});
        check(BikramSambat.fromAd(new Date(2026, 10, 25)), {year: 2083, month: 8, day: 9});
        check(BikramSambat.toAd(2083, 8, 9).getTime(), new Date(2026, 10, 25).getTime());
        check(BikramSambat.fromAd(new Date(1940, 0, 1)), null);
        calendar.mode = "ad";
        calendar.reset();
        const today = BikramSambat.fromAd(calendar.today);
        mouseClick(findChild(calendar, "modeBs"));
        check(calendar.mode, "bs");
        check([calendar.bsYear, calendar.bsMonth], [today.year, today.month]);
        check(findChild(calendar, "calendarHeading").text, BikramSambat.monthNames[today.month - 1] + " " + today.year);
        // Each BS month shows exactly its own days.
        check(calendar.days.filter(day => day.inMonth).length, BikramSambat.daysInMonth(today.year, today.month));
        mouseClick(findChild(calendar, "modeAd"));
        check(calendar.mode, "ad");
        check(calendar.adMonth, calendar.today.getMonth());
    }
}
