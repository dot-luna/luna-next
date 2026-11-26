import QtQuick
import QtTest
import "../../src/shell" as Lock

TestCase {
    id: tests
    name: "LockView"
    visible: true
    when: windowShown
    width: 800
    height: 600
    property var view
    property var form
    property var password
    property var submit
    property var power
    property var dispatched: []
    property int submissions: 0
    property int activities: 0
    property int retries: 0
    property string response: ""
    property var failedTests: []
    readonly property var theme: ({
        colors: {background: "#e1e2e7", lighter_background: "#f0f0f3", foreground: "#343b58",
            bright_foreground: "#1a1b26", accent: "#34548a", selection: "#b7c1df",
            selection_foreground: "#1a1b26", muted: "#b4b5bf", error: "#a52746"},
        fonts: {ui: "DejaVu Sans"},
        appearance: {rounding: 12, blur: {enabled: false, size: 10, passes: 3}}
    })
    readonly property date fixedDate: new Date(2026, 10, 3, 14, 25)

    Component { id: viewComponent; Lock.LockView {} }
    Component { id: powerComponent; Lock.PowerActions {} }

    function init() {
        dispatched = [];
        power = createTemporaryObject(powerComponent, tests, {secure: true,
            supportedActions: ["suspend", "reboot", "powerOff"], shutdownDelay: 3});
        power.dispatchRequested.connect(action => { dispatched = dispatched.concat([action]); });
        view = createTemporaryObject(viewComponent, tests, {theme: theme, dateTime: fixedDate,
            username: "jrtilak", actions: power, width: 800, height: 600, responseRequired: true, keyboardActive: true});
        verify(view !== null);
        tryVerify(() => findChild(view, "lock-password") !== null);
        form = findChild(view, "lock-form");
        password = findChild(view, "lock-password");
        submit = findChild(view, "lock-submit");
        submissions = 0;
        activities = 0;
        retries = 0;
        response = "";
        view.submitted.connect(function (value) { submissions++; response = value; });
        view.activity.connect(function () { activities++; });
        view.retryRequested.connect(function () { retries++; });
        view.activate();
        verify(waitForRendering(view));
    }

    function cleanup() {
        if (qtest_results.failed)
            failedTests = failedTests.concat([qtest_results.functionName]);
    }

    function cleanupTestCase() {
        console.log("LUNA_LOCK_TEST_RESULT " + JSON.stringify({passed: qtest_results.passCount,
            failed: qtest_results.failCount, skipped: qtest_results.skipCount, failedTests: failedTests}));
    }

    function reveal() {
        form.revealPassword("");
        tryCompare(password, "activeFocus", true);
    }

    function test_resting_theme_clock_identity_and_first_key() {
        const clock = findChild(view, "lock-clock");
        compare(clock.text, "14:25");
        compare(String(clock.color), theme.colors.bright_foreground);
        compare(clock.font.family, theme.fonts.ui);
        compare(clock.font.weight, Font.Medium);
        compare(findChild(view, "lock-date").text, Qt.formatDate(fixedDate, "dddd, d MMMM"));
        compare(findChild(view, "lock-username").text, "jrtilak");
        compare(password.visible, false);
        compare(password.echoMode, TextInput.Password);
        verify(password.inputMethodHints & Qt.ImhSensitiveData);
        verify(password.inputMethodHints & Qt.ImhNoPredictiveText);
        compare(password.Accessible.name, "Password");
        keyClick("x");
        compare(form.passwordVisible, true);
        compare(password.text, "x");
        compare(password.activeFocus, true);
        keyClick("y");
        compare(password.text, "xy");
        tryCompare(clock.parent, "opacity", 0);
    }

    function test_enter_submits_and_clears_secret_and_history() {
        reveal();
        for (const character of "sample password") keyClick(character);
        compare(password.text, "sample password");
        keyClick(Qt.Key_Return);
        compare(submissions, 1);
        compare(response, "sample password");
        compare(password.text, "");
        compare(password.canUndo, false);
        compare(password.canRedo, false);
        verify(activities > 0);
    }

    function test_mouse_unlock_and_tab_activation() {
        mouseClick(findChild(view, "lock-avatar"));
        compare(form.passwordVisible, true);
        tryCompare(password, "activeFocus", true);
        password.text = "mouse response";
        mouseClick(submit, submit.width / 2, submit.height / 2, Qt.LeftButton);
        compare(submissions, 1);
        compare(response, "mouse response");
        compare(password.text, "");
        password.forceActiveFocus();
        keyClick(Qt.Key_Tab);
        tryCompare(submit, "activeFocus", true);
        password.text = "keyboard response";
        keyClick(Qt.Key_Space);
        compare(submissions, 2);
        compare(response, "keyboard response");
        compare(password.text, "");
    }

    function test_escape_returns_to_rest_without_submitting_or_restoring_secret() {
        reveal();
        keyClick("s");
        password.selectAll();
        keyClick(Qt.Key_Backspace);
        verify(password.canUndo);
        keyClick(Qt.Key_Escape);
        compare(password.text, "");
        compare(password.canUndo, false);
        compare(password.canRedo, false);
        compare(form.passwordVisible, false);
        compare(password.enabled, false);
        compare(submissions, 0);
        keyClick(Qt.Key_Return);
        compare(form.passwordVisible, true);
        compare(password.text, "");
        compare(submissions, 0);
    }

    function test_busy_disables_submission_and_clears_pending_input() {
        reveal();
        password.text = "discard me";
        view.responseRequired = false;
        view.busy = true;
        compare(password.text, "");
        compare(password.enabled, false);
        compare(submit.enabled, false);
        compare(password.Accessible.description, "Authenticating…");
        keyClick(Qt.Key_Escape);
        compare(form.passwordVisible, false);
        compare(submissions, 0);
    }

    function test_retry_uses_separate_action_and_current_prompt() {
        reveal();
        view.responseRequired = false;
        view.canRetry = true;
        view.busy = false;
        view.prompt = "Verification code";
        compare(password.placeholderText, "Verification code");
        compare(password.Accessible.name, "Verification code");
        compare(submit.text, "Retry");
        mouseClick(submit, submit.width / 2, submit.height / 2, Qt.LeftButton);
        compare(retries, 1);
        compare(submissions, 0);
        view.canRetry = false;
        view.responseRequired = true;
        view.responseVisible = true;
        compare(password.echoMode, TextInput.Normal);
        tryCompare(password, "activeFocus", true);
        view.statusText = "Try again";
        compare(password.placeholderText, "Try again");
        compare(password.Accessible.description, "Try again");
    }

    function test_changing_monitor_discards_secret_and_history() {
        reveal();
        keyClick("s");
        view.keyboardActive = false;
        compare(password.text, "");
        compare(password.canUndo, false);
        compare(form.passwordVisible, false);
        view.keyboardActive = true;
        view.activate();
        keyClick("n");
        compare(password.text, "n");
    }

    function test_clear_signal_clears_all_native_authentication_responses() {
        reveal();
        keyClick("s");
        view.clearInput();
        compare(password.text, "");
        compare(password.canUndo, false);
        compare(password.canRedo, false);
    }

    function test_common_monitor_sizes_keep_identity_and_form_centered() {
        for (const size of [[1366, 768], [1920, 1080], [2560, 1440], [1080, 1920]]) {
            view.width = size[0];
            view.height = size[1];
            compare(form.width, 320);
            compare(form.x, (view.width - form.width) / 2);
            verify(form.y > 0);
            verify(form.y + form.implicitHeight < view.height);
            compare(password.background.radius, 12);
        }
    }

    function test_leading_space_is_preserved_and_modified_keys_do_not_open_the_form() {
        keyClick("a", Qt.ControlModifier);
        compare(form.passwordVisible, false);
        keyClick(Qt.Key_Space);
        compare(password.text, " ");
    }

    function test_supported_actions_are_keyboard_and_mouse_accessible_only_while_resting() {
        const sleep = findChild(view, "suspendButton");
        verify(sleep !== null);
        compare(findChild(view, "hibernateButton"), null);
        mouseClick(sleep);
        compare(dispatched, ["suspend"]);
        sleep.forceActiveFocus();
        keyClick(Qt.Key_Space);
        compare(dispatched, ["suspend", "suspend"]);
        reveal();
        compare(sleep.enabled, false);
        compare(findChild(view, "lock-actions").enabled, false);
    }

    function test_shutdown_clears_all_outputs_and_escape_and_mouse_cancel_before_dispatch() {
        const other = createTemporaryObject(viewComponent, tests, {theme: theme, dateTime: fixedDate,
            username: "jrtilak", actions: power, width: 1920, height: 1080});
        verify(other !== null);
        const otherForm = findChild(other, "lock-form");
        reveal();
        keyClick("s");
        verify(power.requestAction("powerOff"));
        compare(form.passwordVisible, false);
        compare(password.text, "");
        compare(password.canUndo, false);
        compare(form.enabled, false);
        compare(otherForm.enabled, false);
        compare(findChild(view, "shutdownMessage").text, "Shutting down in 3 seconds");
        keyClick(Qt.Key_Escape);
        compare(power.shutdownActive, false);
        compare(form.enabled, true);
        compare(otherForm.enabled, true);
        compare(dispatched, []);
        verify(power.requestAction("powerOff"));
        const cancel = findChild(view, "cancelShutdownButton");
        mouseClick(cancel);
        compare(power.shutdownActive, false);
        compare(dispatched, []);
    }

    function test_shutdown_dispatches_once_and_zero_delay_is_immediate() {
        power.shutdownDelay = 0;
        verify(power.requestAction("powerOff"));
        compare(dispatched, ["powerOff"]);
        compare(power.committed, true);
        verify(!power.cancelShutdown());
        verify(!power.requestAction("powerOff"));
        compare(dispatched, ["powerOff"]);
    }

    function test_shutdown_deadline_and_secure_state_gate_actions() {
        power.secure = false;
        verify(!power.requestAction("powerOff"));
        power.secure = true;
        power.authenticationBusy = true;
        verify(!power.requestAction("suspend"));
        power.authenticationBusy = false;
        verify(!power.requestAction("hibernate"));
        power.shutdownDelay = 1;
        verify(power.requestAction("powerOff"));
        power.secure = false;
        compare(power.shutdownActive, false);
        compare(dispatched, []);
        power.secure = true;
        verify(power.requestAction("powerOff"));
        tryCompare(power, "committed", true, 2000);
        compare(dispatched, ["powerOff"]);
    }
}
