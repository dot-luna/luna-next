import QtQuick
import QtQuick.Window
import QtTest
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import "../../src/shell" as Menu
import "../../src/shell/Applications.js" as Applications
import "../../src/shell/System.js" as System
import "../../src/shell/Query.js" as Query

TestCase {
    id: tests
    name: "MenuContent"
    visible: true
    property var card
    property var input
    property var action
    property var queryAction
    property var requestedActions: []
    property var activated
    property int dismissed: 0
    property var failedTests: []
    property url windowSource
    readonly property var theme: JSON.parse(Quickshell.env("LUNA_MENU_THEME"))
    readonly property var nativeApplications: DesktopEntries.applications.values

    Component {
        id: contentComponent
        Menu.MenuContent {
            width: implicitWidth
            height: implicitHeight
            onQueryActivated: entry => tests.queryAction = entry
            onActionActivated: action => tests.action = action
            onApplicationActivated: entry => tests.activated = entry
            onDismissed: tests.dismissed++
        }
    }

    function check(actual, expected, message) {
        try {
            compare(actual, expected, message);
        } catch (error) {
            console.error(qtest_results.functionName + ": " + (message || "") + " actual=" + JSON.stringify(actual)
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
        action = null;
        queryAction = null;
        requestedActions = [];
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
        console.log("LUNA_MENU_TEST_RESULT " + JSON.stringify({passed: qtest_results.passCount,
            failed: qtest_results.failCount, skipped: qtest_results.skipCount, failedTests: failedTests}));
    }

    function test_original_root_entries_and_return_enters_the_sorted_app_list() {
        check(card.entries.map(entry => entry.name).join(","), "Apps,Insert,Learn,Trigger,Style,Setup,Install,Remove,About,System");
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
        check(card.entries.length, 2);
        check(card.entries[0].id, "editor");
        keyClick(Qt.Key_Return);
        check(activated.id, "editor");
        input.text = "$HOME; .*";
        check(card.entries.length, 1);
        check(card.entries[0].queryAction, "search");
        check(card.entries[0].value, "$HOME; .*");
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

    function test_alt_left_and_empty_backspace_return_to_root_and_clear_keeps_apps() {
        for (const key of [Qt.Key_Backspace, Qt.Key_Left]) {
            card.activate(0);
            keyClick(key, key === Qt.Key_Left ? Qt.AltModifier : Qt.NoModifier);
            check(card.appsView, false);
        }
        card.activate(0);
        input.text = "editor";
        const clear = findChild(card, "clearSearch");
        verify(clear.visible);
        mouseClick(clear);
        check(card.appsView, true);
        check(input.text, "");
        check(input.activeFocus, true);
    }

    function test_empty_results_cannot_launch_or_produce_invalid_selection() {
        card.applications = [];
        card.activate(0);
        check(card.entries.length, 0);
        check(card.selectedIndex, -1);
        keyClick(Qt.Key_Down);
        keyClick(Qt.Key_Up);
        keyClick(Qt.Key_Return);
        check(activated, null);
        check(card.selectedIndex, -1);
        input.text = "no matching application";
        check(card.entries.length, 1);
        check(card.selectedIndex, 0);
        keyClick(Qt.Key_Return);
        check(queryAction.queryAction, "search");
        check(activated, null);
    }

    function test_results_animate_while_latest_search_and_selection_remain_actionable() {
        const list = findChild(card, "applicationList");
        tryCompare(list, "opacity", 1);
        input.text = "browser";
        input.text = "editor";
        check(card.selectedEntry.id, "editor");
        list.forceLayout();
        verify(waitForRendering(card));
        const result = list.currentItem;
        verify(result !== null);
        tryVerify(() => list.opacity > 0 && list.opacity < 1);
        const outgoing = findChild(card, "outgoingResults");
        verify(outgoing.count > 0);
        verify(outgoing.opacity > 0);
        check(outgoing.enabled, false, "Outgoing results cannot receive input");
        const position = result.y;
        keyClick(Qt.Key_Return);
        check(activated.id, "editor");
        check(input.activeFocus, true);
        tryCompare(list, "opacity", 1);
        tryCompare(outgoing, "opacity", 0);
        tryCompare(outgoing, "count", 0);
        check(result.y, position, "Result stays in place while fading");

        card.reset();
        card.activate(0);
        list.forceLayout();
        verify(waitForRendering(card));
        keyClick(Qt.Key_Down);
        check(card.selectedIndex, 1);
        const destination = list.currentItem.y;
        check(list.highlightItem.y !== destination, true, "Selection highlight animates toward the new row");
        activated = null;
        keyClick(Qt.Key_Return);
        check(activated.id, "editor");
        tryCompare(list.highlightItem, "y", destination);

        input.text = "editor";
        list.forceLayout();
        verify(waitForRendering(card));
        check(list.highlightItem.y, list.currentItem.y, "Searching resets the highlight without vertical travel");
    }

    function test_reset_discards_the_previous_search_and_uses_theme_font_and_rounding() {
        card.activate(0);
        input.text = "editor";
        card.reset();
        check(card.appsView, false);
        check(input.text, "");
        check(card.entries.length, 10);
        check(input.font.family, theme.fonts.ui);
        const color = Qt.color(theme.colors.background);
        check(card.color, Qt.rgba(color.r, color.g, color.b, theme.appearance.opacity.active));
        check(card.radius, theme.appearance.rounding);
        check(card.border.width, theme.appearance.border_width);
    }

    function test_placeholders_do_not_navigate_or_launch_and_panel_height_stays_fixed() {
        const height = card.height;
        for (let index = 1; index < card.entries.length; index++) {
            if (card.entries[index].route || card.entries[index].action) continue;
            card.activate(index);
            check(card.appsView, false);
            check(activated, null);
            check(dismissed, 0);
        }
        card.activate(0);
        check(card.height, height);
        input.text = "no results";
        check(card.height, height);
        check(input.placeholderText, "Search…");
    }

    function test_home_end_and_page_keys_navigate_without_editing_the_query() {
        card.applications = Array.from({length: 30}, (_, index) => application("app" + index, "App " + String(index).padStart(2, "0")));
        card.activate(0);
        input.text = "App";
        keyClick(Qt.Key_End);
        check(card.selectedIndex, 30);
        check(card.selectedEntry.queryAction, "search");
        keyClick(Qt.Key_PageUp);
        verify(card.selectedIndex < 30);
        keyClick(Qt.Key_Home);
        check(card.selectedIndex, 0);
        keyClick(Qt.Key_PageDown);
        verify(card.selectedIndex > 0);
        check(input.text, "App");
        check(input.activeFocus, true);
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

    function test_system_route_preserves_old_list_searches_and_only_activates_supported_actions() {
        input.text = "system";
        keyClick(Qt.Key_Return);
        check(card.section, "system");
        check(input.text, "");
        check(card.entries.map(entry => entry.name).join(","), "Screensaver,Lock,Suspend,Hibernate,Logout,Reboot,Shutdown");
        for (let index = 2; index < 4; index++) {
            card.activate(index);
            check(action, null);
        }
        for (const name of ["screensaver", "lock", "logout", "reboot", "shutdown"]) {
            input.text = name;
            check(card.entries.length, 2);
            keyClick(Qt.Key_Return);
            check(action, name);
            check(dismissed, 0);
        }
        keyClick(Qt.Key_Escape);
        check(card.section, "root");
        check(input.text, "");
        for (const key of [Qt.Key_Backspace, Qt.Key_Left]) {
            input.text = "system";
            keyClick(Qt.Key_Return);
            keyClick(key, key === Qt.Key_Left ? Qt.AltModifier : Qt.NoModifier);
            check(card.section, "root");
        }
    }

    function test_parent_search_finds_every_nested_child_with_its_path() {
        for (const name of ["screensaver", "lock", "logout", "reboot", "shutdown", "stay awake"]) {
            input.text = name;
            const entry = card.entries.find(entry => entry.action === name.replace(" ", "-"));
            verify(entry !== undefined, "Root finds " + name);
            verify(entry.parentName.length > 0);
        }
        input.text = "system lock";
        check(card.entries[0].action, "lock");
        check(card.entries[0].parentName, "System");
        keyClick(Qt.Key_Return);
        check(action, "lock");
        input.text = "trigger toggles stay awake";
        check(card.entries[0].action, "stay-awake");
        check(card.entries[0].parentName, "Trigger › Toggles");
        card.stayAwake = true;
        check(card.entries[0].checked, true, "Search results keep live toggle state");
        const list = findChild(card, "applicationList");
        list.forceLayout();
        verify(waitForRendering(card));
        check(findChild(card, "applicationRow0").entry.parentName, "Trigger › Toggles");

        card.reset("trigger");
        check(card.entries.map(entry => entry.name).join(","), "Toggles");
        input.text = "stay awake";
        check(card.entries[0].action, "stay-awake");
        check(card.entries[0].parentName, "Toggles");
        input.text = "lock";
        check(card.entries.length, 1, "Search stays within the current parent's descendants");
        check(card.entries[0].queryAction, "search");
    }

    function test_trigger_toggles_navigation_returns_through_visited_parents() {
        card.activate(card.entries.findIndex(entry => entry.route === "trigger"));
        check(card.section, "trigger");
        keyClick(Qt.Key_Return);
        check(card.section, "toggles");
        check(card.entries.length, 1);
        check(card.entries[0].action, "stay-awake");
        keyClick(Qt.Key_Return);
        check(action, "stay-awake");
        keyClick(Qt.Key_Escape);
        check(card.section, "trigger");
        keyClick(Qt.Key_Backspace);
        check(card.section, "root");
        check(dismissed, 0);
        keyClick(Qt.Key_Escape);
        check(dismissed, 1);
    }

    function test_search_navigation_returns_to_the_parent_that_was_actually_visited() {
        input.text = "toggles";
        keyClick(Qt.Key_Return);
        check(card.section, "toggles");
        keyClick(Qt.Key_Escape);
        check(card.section, "root");
        check(input.text, "");
        check(dismissed, 0);
    }

    function test_directly_opened_sections_dismiss_without_inventing_a_parent() {
        for (const section of ["system", "apps", "trigger", "toggles"]) {
            for (const query of ["", "some query"]) {
                card.reset();
                card.activate(0);
                card.reset(section);
                input.text = query;
                const before = dismissed;
                keyClick(Qt.Key_Escape);
                check(dismissed, before + 1);
                check(card.section, section);
            }
        }
    }

    function test_requested_system_icons_are_used() {
        const entries = System.entries();
        check(entries.find(entry => entry.action === "screensaver").icon, "play");
        check(entries.find(entry => entry.action === "lock").icon, "ai-lock");
        check(entries.find(entry => entry.action === "shutdown").icon, "shut-down");
        verify(entries.every(entry => entry.action !== "stay-awake"));
    }

    function test_about_uses_the_fastfetch_terminal_and_unknown_actions_have_no_command() {
        input.text = "about";
        keyClick(Qt.Key_Return);
        check(action, "about");
        check(JSON.stringify(System.aboutCommand()), JSON.stringify(["xdg-terminal-exec",
            "--app-id=luna-next-fastfetch", "--title=Fastfetch", "--", "bash", "-c",
            'fastfetch; status=$?; read -r -s -n 1; exit "$status"']));
        for (const unsupported of ["suspend", "hibernate", "unknown"])
            check(System.command(unsupported).length, 0);
        check(JSON.stringify(System.command("screensaver", "/a home/.local/bin/luna")),
            JSON.stringify(["/a home/.local/bin/luna", "screensaver"]));
        check(JSON.stringify(System.command("lock", "/a home/.local/bin/luna")),
            JSON.stringify(["/a home/.local/bin/luna", "lock"]));
    }

    Component {
        id: powerComponent
        Menu.PowerScreen {
            width: 800
            height: 700
            uiFont: tests.theme.fonts.ui
            textSize: 10
            onRequested: action => tests.requestedActions = tests.requestedActions.concat([action])
        }
    }

    function test_power_countdown_starts_at_five_animates_and_escape_cancels() {
        const power = createTemporaryObject(powerComponent, tests);
        verify(power !== null);
        power.begin("reboot");
        check(power.seconds, 5);
        check(power.cancellable, true);
        check(requestedActions.length, 0);
        tryVerify(() => power.opacity > 0 && power.opacity < 1);
        tryCompare(power, "seconds", 4, 1500);
        check(findChild(power, "powerMessage").text, "Rebooting in 4 seconds…");
        keyClick(Qt.Key_Escape);
        check(power.active, false);
        power.updateCountdown(Date.now() + 10000);
        check(requestedActions.length, 0);
        power.begin("shutdown");
        check(power.seconds, 5);
        check(findChild(power, "powerMessage").text, "Shutting down in 5 seconds…");
        const cancel = findChild(power, "cancelPower");
        verify(waitForRendering(cancel));
        mouseClick(cancel);
        check(power.active, false);
        power.updateCountdown(Date.now() + 10000);
        check(requestedActions.length, 0);
    }

    function test_power_expiry_dispatches_once_and_ignores_repeated_activation() {
        const power = createTemporaryObject(powerComponent, tests);
        power.begin("shutdown");
        const deadline = power.deadline;
        power.begin("reboot");
        check(power.action, "shutdown");
        check(power.deadline, deadline);
        power.updateCountdown(deadline - 1000);
        check(power.seconds, 1);
        check(requestedActions.length, 0);
        power.updateCountdown(deadline);
        check(requestedActions.join(","), "shutdown");
        check(power.cancellable, false);
        check(power.cancel(), false);
        power.updateCountdown(deadline + 1000);
        check(requestedActions.length, 1);
        power.failure = "Couldn’t shut down";
        check(power.cancellable, true);
        keyClick(Qt.Key_Escape);
        check(power.active, false);
        power.begin("logout");
        check(requestedActions.join(","), "shutdown,logout");
        check(power.committed, true);
    }

    function test_terminal_prefix_is_explicit_and_preserves_shell_syntax_as_one_argument() {
        const source = 'printf "%s\\n" "a b" | cat; echo "$HOME"';
        input.text = "! " + source;
        check(card.entries[0].queryAction, "terminal");
        check(queryAction, null, "Typing does not execute a command");
        keyClick(Qt.Key_Return);
        check(queryAction.value, source);
        check(JSON.stringify(Query.command(queryAction, "/bin/bash")),
            JSON.stringify(["xdg-terminal-exec", "--", "bash", "-c",
                '"$1" -lc "$2"; status=$?; read -r -s -n 1; exit "$status"', "luna-menu", "/bin/bash", source]));
        input.text = "!   ";
        check(card.entries.length, 1);
        check(card.entries[0].queryAction, "search");
    }

    function test_url_opening_and_final_browser_search_work_in_every_section() {
        for (const section of ["root", "apps", "system", "trigger", "toggles"]) {
            card.reset(section);
            input.text = "editor";
            check(card.entries[card.entries.length - 1].queryAction, "search");
            keyClick(Qt.Key_End);
            keyClick(Qt.Key_Return);
            check(queryAction.value, "editor");
            input.text = " https://example.com/path?a=1&b=two#part ";
            check(card.entries[0].queryAction, "url");
            keyClick(Qt.Key_Home);
            keyClick(Qt.Key_Return);
            check(JSON.stringify(Query.command(queryAction, "")), JSON.stringify(["xdg-open", "https://example.com/path?a=1&b=two#part"]));
            check(card.entries[card.entries.length - 1].queryAction, "search");
        }
        for (const address of ["example.com", "www.example.com/a", "http://localhost:8080/a", "https://例子.中国/path"])
            verify(Query.webAddress(address) !== "");
        for (const text of ["find example.com", "javascript:alert(1)", "https://", "https://example.com\nreboot", "a; reboot"])
            check(Query.webAddress(text), "");
        const literal = 'café & cats #? $(touch UNEXPECTED)';
        const command = Query.command({queryAction: "search", value: literal}, "");
        check(command[0], "xdg-open");
        check(command.length, 2);
        check(command[1], "https://duckduckgo.com/?q=" + encodeURIComponent(literal));
        check(Query.command({queryAction: "unknown", value: "hello"}, "").length, 0);
    }

    function sessionWindow() {
        const component = Qt.createComponent(windowSource);
        check(component.status, Component.Ready, component.errorString());
        const window = createTemporaryObject(component, null, {theme: theme});
        verify(window !== null);
        window.show("system");
        tryCompare(window, "visible", true);
        tryVerify(() => window.content.Window.window !== null);
        window.content.Window.window.requestActivate();
        tryCompare(window.content.Window.window, "active", true);
        verify(waitForRendering(window.content));
        return window;
    }

    function test_stay_awake_keyboard_mouse_and_hidden_menu_lifetime() {
        const window = sessionWindow();
        const content = window.content;
        window.show("toggles");
        content.focusSearch();
        tryCompare(findChild(content, "searchInput"), "activeFocus", true);
        const index = content.entries.findIndex(entry => entry.action === "stay-awake");
        const power = findChild(window.contentItem, "powerScreen");
        check(window.stayAwake, false);
        content.jumpSelection(index);
        keyClick(Qt.Key_Return);
        check(window.stayAwake, true, "Enter enables stay awake");
        check(content.selectedIndex, index);
        check(power.active, false);
        check(window.opened, true);
        const row = findChild(content, "applicationRow" + index);
        tryVerify(() => row.entry.checked === true);
        check(row.Accessible.checkable, true, "The row is accessible as checkable");
        check(row.Accessible.checked, true, "The accessible row is checked");
        check(findChild(row, "toggleState").text, "On");
        window.hide();
        check(window.stayAwake, true, "Hiding preserves stay awake");
        window.show("toggles");
        content.focusSearch();
        const reopenedRow = findChild(content, "applicationRow" + index);
        verify(waitForRendering(reopenedRow));
        mouseClick(reopenedRow);
        check(window.stayAwake, false, "Click disables stay awake after reopening");
        const disabledRow = findChild(content, "applicationRow" + index);
        check(disabledRow.Accessible.checked, false);
        check(findChild(disabledRow, "toggleState").text, "Off");
        const input = findChild(content, "searchInput");
        input.text = "stay awake";
        check(content.entries[0].action, "stay-awake");
        keyClick(Qt.Key_Return);
        check(window.stayAwake, true, "Enter enables stay awake in search results");
        check(input.text, "stay awake");
        // Offscreen floating surfaces can activate; layer-shell keyboard focus
        // is compositor-only. The search must retain focus inside the menu.
        check(input.focus, true, "Search keeps focus after toggling");
        window.hide();
    }

    function test_window_power_actions_execute_only_after_expiry_and_logout_is_immediate() {
        for (const action of ["reboot", "shutdown", "logout"]) {
            const window = sessionWindow();
            const content = window.content;
            const power = findChild(window.contentItem, "powerScreen");
            const process = findChild(window, "sessionCommand");
            verify(power !== null && process !== null);
            content.activate(content.entries.findIndex(entry => entry.action === action));
            check(power.action, action);
            check(content.visible, false);
            check(window.BackgroundEffect.blurRegion, null);
            if (action !== "logout") {
                check(process.running, false);
                check(process.finished, false);
                if (action === "reboot") {
                    // Exercise the real five-second timer once, with only the private recorder executable.
                    tryCompare(power, "committed", true, 6000);
                } else {
                    power.updateCountdown(power.deadline);
                }
            }
            tryCompare(process, "finished", true);
            check(power.failure, "");
            check(power.cancel(), false);
            window.show();
            check(power.action, action, "IPC cannot restart an already committed request");
            window.destroy();
        }
    }

    function test_window_escape_and_ipc_hide_cancel_before_any_session_command() {
        const window = sessionWindow();
        const content = window.content;
        const power = findChild(window.contentItem, "powerScreen");
        const process = findChild(window, "sessionCommand");
        const reboot = content.entries.findIndex(entry => entry.action === "reboot");
        content.activate(reboot);
        keyClick(Qt.Key_Escape);
        check(power.active, false, "Escape cancels the window countdown");
        check(content.section, "system");
        check(content.visible, true);
        check(process.finished, false);
        check(window.opened, true);
        content.activate(reboot);
        window.hide();
        check(power.active, false);
        check(window.opened, false);
        power.updateCountdown(Date.now() + 10000);
        check(process.finished, false);
        window.show("system");
        content.activate(reboot);
        window.show();
        check(power.active, false);
        check(content.section, "root");
        power.updateCountdown(Date.now() + 10000);
        check(process.finished, false);
        window.hide();
    }

    function test_window_escape_closes_direct_system_even_after_cancelling_power() {
        const window = sessionWindow();
        const content = window.content;
        content.focusSearch();
        tryCompare(findChild(content, "searchInput"), "activeFocus", true);
        keyClick(Qt.Key_Escape);
        check(window.opened, false);
        window.show();
        content.activate(content.entries.findIndex(entry => entry.route === "system"));
        content.activate(content.entries.findIndex(entry => entry.action === "reboot"));
        keyClick(Qt.Key_Escape);
        keyClick(Qt.Key_Escape);
        check(content.section, "root", "Cancelling power preserves navigation from root");
        check(window.opened, true);
        window.show("system");
        content.activate(content.entries.findIndex(entry => entry.action === "reboot"));
        keyClick(Qt.Key_Escape);
        check(window.opened, true);
        keyClick(Qt.Key_Escape);
        check(window.opened, false, "Cancelling power preserves a direct opening");
    }

    function test_failed_session_request_shows_an_error_and_escape_restores_the_system_menu() {
        const window = sessionWindow();
        const content = window.content;
        const power = findChild(window.contentItem, "powerScreen");
        const process = findChild(window, "sessionCommand");
        process.environment = {MENU_SESSION_FAIL: "1"};
        content.activate(content.entries.findIndex(entry => entry.action === "shutdown"));
        power.updateCountdown(power.deadline);
        tryCompare(process, "finished", true);
        check(power.failure, "Couldn’t shut down");
        check(power.cancellable, true);
        keyClick(Qt.Key_Escape);
        check(power.active, false, "Escape cancels the window countdown");
        check(content.section, "system");
        check(content.visible, true);
        const input = findChild(content, "searchInput");
        tryCompare(input, "activeFocus", true);
        window.hide();
    }

    function test_missing_session_executable_does_not_leave_an_uncancellable_black_screen() {
        const window = sessionWindow();
        const power = findChild(window.contentItem, "powerScreen");
        const process = findChild(window, "sessionCommand");
        power.begin("reboot");
        process.exec(["/nonexistent-luna-session-command"]);
        tryCompare(process, "finished", true);
        check(power.failure, "Couldn’t reboot");
        verify(power.cancel());
        check(window.content.section, "system");
        window.hide();
    }

    function test_window_about_opens_the_same_fastfetch_terminal_and_dismisses() {
        const window = sessionWindow();
        window.content.reset();
        const index = window.content.entries.findIndex(entry => entry.action === "about");
        window.content.activate(index);
        check(window.opened, false);
    }

    function test_window_screensaver_and_lock_hide_immediately_without_a_power_countdown() {
        for (const action of ["screensaver", "lock"]) {
            const window = sessionWindow();
            const power = findChild(window.contentItem, "powerScreen");
            const process = findChild(window, "applicationCommand");
            window.content.activate(window.content.entries.findIndex(entry => entry.action === action));
            check(window.opened, false);
            check(power.active, false);
            tryCompare(process, "finished", true);
        }
    }

    function test_window_query_actions_use_native_launchers_and_dismiss() {
        for (const text of ['! printf "%s" "a b" | cat', "https://example.com/a?x=1&y=2", "café & cats #? $(touch UNEXPECTED)"]) {
            const window = sessionWindow();
            const input = findChild(window.content, "searchInput");
            input.text = text;
            check(window.opened, true, "Typing never launches anything");
            const row = findChild(window.content, "applicationRow0");
            verify(waitForRendering(row));
            mouseClick(row);
            check(window.opened, false);
        }
    }

    function test_window_blurs_only_the_card_and_follows_theme_geometry() {
        const component = Qt.createComponent(windowSource);
        check(component.status, Component.Ready, component.errorString());
        const window = createTemporaryObject(component, null, {theme: theme});
        verify(window !== null);
        const region = window.BackgroundEffect.blurRegion;
        verify(region !== null);
        check(region.item, window.content);
        check(region.radius, theme.appearance.rounding);
        window.show();
        tryCompare(window, "visible", true);
        const originalWidth = window.content.width;
        const originalHeight = window.content.height;
        window.width = 400;
        window.height = 350;
        tryVerify(() => window.content.width < originalWidth && window.content.height < originalHeight);
        verify(region.item.x > 0 && region.item.y > 0);
        verify(region.item.width < window.width && region.item.height < window.height);
        const disabled = JSON.parse(JSON.stringify(theme));
        disabled.appearance.blur.enabled = false;
        window.theme = disabled;
        check(window.BackgroundEffect.blurRegion, null);
        const unblurredWindow = createTemporaryObject(component, null, {theme: disabled});
        verify(unblurredWindow !== null);
        check(unblurredWindow.BackgroundEffect.blurRegion, null);
        check(unblurredWindow.visible, false);
        const enabled = JSON.parse(JSON.stringify(theme));
        enabled.appearance.rounding = 27;
        window.theme = enabled;
        check(window.BackgroundEffect.blurRegion, region);
        check(region.radius, 27);
        check(region.radius, window.content.radius);
        window.hide();
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
