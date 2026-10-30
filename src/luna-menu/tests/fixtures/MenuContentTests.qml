import QtQuick
import QtTest
import Quickshell
import Quickshell.Io
import "../../src/shell" as Menu
import "../../src/shell/Applications.js" as Applications

TestCase {
    id: tests
    name: "MenuContent"
    visible: true
    property var card
    property var input
    property var activated
    property int dismissed: 0
    property var failedTests: []
    property url windowSource
    readonly property var theme: JSON.parse(Quickshell.env("LUNA_NEXT_MENU_THEME"))
    readonly property var nativeApplications: DesktopEntries.applications.values

    Component {
        id: contentComponent
        Menu.MenuContent {
            width: implicitWidth
            height: implicitHeight
            onApplicationActivated: entry => tests.activated = entry
            onDismissed: tests.dismissed++
        }
    }

    function check(actual, expected, message) {
        try {
            compare(actual, expected, message);
        } catch (error) {
            console.error(qtest_results.functionName + ": actual=" + JSON.stringify(actual)
                + " expected=" + JSON.stringify(expected));
            throw error;
        }
    }

    function application(id, name, extra) {
        return Object.assign({id: id, name: name, genericName: "", comment: "", keywords: [],
            command: ["never-launched"], icon: "", noDisplay: false, execute: function() {}}, extra || {});
    }

    function init() {
        activated = null;
        dismissed = 0;
        card = createTemporaryObject(contentComponent, tests, {
            theme: theme,
            applications: [application("editor", "Editor", {genericName: "Text editor", keywords: ["writing"]}),
                application("browser", "Browser", {comment: "Browse websites"}),
                application("hidden", "No Display", {noDisplay: true}),
                application("broken", "No command", {command: []})]
        });
        verify(card !== null);
        input = findChild(card, "searchInput");
        wait(0);
        card.reset();
        card.focusSearch();
        tryCompare(input, "activeFocus", true);
    }

    function cleanup() {
        if (qtest_results.failed)
            failedTests = failedTests.concat([qtest_results.functionName]);
    }

    function cleanupTestCase() {
        console.log("LUNA_NEXT_MENU_TEST_RESULT " + JSON.stringify({passed: qtest_results.passCount,
            failed: qtest_results.failCount, skipped: qtest_results.skipCount, failedTests: failedTests}));
    }

    function test_root_has_only_apps_and_return_enters_the_sorted_app_list() {
        check(card.entries.length, 1);
        check(card.entries[0].name, "Apps");
        check(card.appsView, false);
        keyClick(Qt.Key_Return);
        check(card.appsView, true);
        check(card.entries.map(entry => entry.name).join(","), "Browser,Editor");
        check(card.selectedIndex, 0);
        check(activated, null);
    }

    function test_typing_at_root_searches_metadata_and_keeps_queries_literal() {
        input.text = " WRITING text ";
        check(card.entries.length, 1);
        check(card.entries[0].id, "editor");
        keyClick(Qt.Key_Return);
        check(activated.id, "editor");
        input.text = "$HOME; .*";
        check(card.entries.length, 0);
    }

    function test_name_matches_rank_before_metadata_with_a_stable_tie_breaker() {
        const entries = [application("3", "Other", {comment: "editor"}),
            application("2", "My Editor"), application("1", "Editor")];
        check(Applications.find(entries, "editor").map(entry => entry.id).join(","), "1,2,3");
    }

    function test_up_down_tab_and_shift_tab_wrap_selection_without_leaving_search() {
        keyClick(Qt.Key_Return);
        keyClick(Qt.Key_Down);
        check(card.selectedIndex, 1);
        keyClick(Qt.Key_Tab);
        check(card.selectedIndex, 0);
        keyClick(Qt.Key_Tab, Qt.ShiftModifier);
        check(card.selectedIndex, 1);
        keyClick(Qt.Key_Up);
        check(card.selectedIndex, 0);
        check(input.activeFocus, true);
    }

    function test_enter_and_mouse_activate_the_selected_application() {
        keyClick(Qt.Key_Return);
        keyClick(Qt.Key_Down);
        keyClick(Qt.Key_Enter);
        check(activated.id, "editor");
        activated = null;
        const row = findChild(card, "applicationRow0");
        verify(row !== null);
        verify(waitForRendering(row));
        mouseClick(row);
        check(activated.id, "browser");
    }

    function test_escape_backs_to_root_then_dismisses() {
        keyClick(Qt.Key_Return);
        input.text = "editor";
        keyClick(Qt.Key_Escape);
        check(card.appsView, false);
        check(input.text, "");
        check(card.entries[0].route, "apps");
        check(dismissed, 0);
        keyClick(Qt.Key_Escape);
        check(dismissed, 1);
    }

    function test_back_button_alt_left_and_empty_backspace_return_to_root() {
        for (const key of [Qt.Key_Backspace, Qt.Key_Left]) {
            card.activate(0);
            keyClick(key, key === Qt.Key_Left ? Qt.AltModifier : Qt.NoModifier);
            check(card.appsView, false);
        }
        card.activate(0);
        const back = findChild(card, "backButton");
        verify(back.visible);
        mouseClick(back);
        check(card.appsView, false);
        check(input.activeFocus, true);
    }

    function test_empty_results_cannot_launch_or_produce_invalid_selection() {
        input.text = "no matching application";
        check(card.entries.length, 0);
        check(card.selectedIndex, -1);
        keyClick(Qt.Key_Down);
        keyClick(Qt.Key_Up);
        keyClick(Qt.Key_Return);
        check(activated, null);
        check(card.selectedIndex, -1);
        input.text = "";
        check(card.selectedIndex, 0);
    }

    function test_reset_discards_the_previous_search_and_uses_theme_font_and_rounding() {
        card.activate(0);
        input.text = "editor";
        card.reset();
        check(card.appsView, false);
        check(input.text, "");
        check(card.entries.length, 1);
        check(input.font.family, theme.fonts.ui);
        check(card.color, theme.colors.background);
        check(card.radius, theme.appearance.rounding);
        check(card.border.width, theme.appearance.border_width);
    }

    function test_native_desktop_entries_exclude_hidden_and_no_display_and_search_keywords() {
        tryVerify(() => nativeApplications.length === 2);
        check(nativeApplications.map(entry => entry.name).sort().join(","), "Fixture Editor,Fixture Terminal");
        check(Applications.find(nativeApplications, "writing").length, 2);
        check(Applications.find(nativeApplications, "hidden").length, 0);
        const normal = nativeApplications.find(entry => entry.id === "luna-test-editor");
        check(Array.from(normal.command).slice(-1)[0], "literal argument; $HOME");
    }

    function test_gui_launch_uses_native_execute_and_terminal_launch_keeps_argument_boundaries() {
        let executions = 0;
        let detached = null;
        const gui = application("gui", "GUI", {execute: function() { executions++; }});
        verify(Applications.launch(gui, context => detached = context));
        check(executions, 1);
        check(detached, null);
        const terminal = application("terminal", "Terminal", {runInTerminal: true,
            command: ["editor", "a file; $(touch UNEXPECTED)", "--flag"], workingDirectory: "/a directory"});
        verify(Applications.launch(terminal, context => detached = context));
        check(JSON.stringify(detached.command), JSON.stringify(["xdg-terminal-exec", "--", "editor", "a file; $(touch UNEXPECTED)", "--flag"]));
        check(detached.workingDirectory, "/a directory");
    }

    function test_native_launches_only_run_the_isolated_recorders() {
        tryVerify(() => nativeApplications.length === 2);
        for (const entry of nativeApplications)
            verify(Applications.launch(entry, context => Quickshell.execDetached(context)));
    }

    function test_window_starts_hidden_and_outside_click_dismisses_but_inside_does_not() {
        const component = Qt.createComponent(windowSource);
        check(component.status, Component.Ready, component.errorString());
        const window = createTemporaryObject(component, null, {theme: theme});
        verify(window !== null);
        check(window.visible, false);
        check(window.opened, false);
        window.show();
        tryCompare(window, "visible", true);
        window.content.focusSearch();
        wait(0);
        verify(waitForRendering(window.content));
        mouseClick(window.content, 5, 5);
        check(window.opened, true);
        const dismiss = findChild(window.contentItem, "dismissArea");
        mouseClick(dismiss, 1, 1);
        check(window.opened, false);
        check(window.visible, false);
        window.show();
        window.content.activate(0);
        window.hide();
        window.show();
        check(window.content.appsView, false);
    }
}
