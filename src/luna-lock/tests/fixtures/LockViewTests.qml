import QtQuick
import QtTest
import Quickshell
import "../../src/shell" as Lock

TestCase {
    id: tests
    name: "LockView"
    visible: true
    property var view
    property var password
    property var submit
    property int submissions: 0
    property int activities: 0
    property int retries: 0
    property string response: ""
    property var failedTests: []
    readonly property var theme: JSON.parse(Quickshell.env("LUNA_LOCK_THEME"))
    readonly property date fixedDate: new Date(2026, 10, 3, 14, 25)

    Component { id: viewComponent; Lock.LockView {} }

    function init() {
        view = createTemporaryObject(viewComponent, tests, {theme: theme, dateTime: fixedDate,
            width: 800, height: 600, responseRequired: true, keyboardActive: true});
        verify(view !== null);
        password = findChild(view, "lock-password");
        submit = findChild(view, "lock-submit");
        verify(password !== null);
        verify(submit !== null);
        submissions = 0;
        activities = 0;
        retries = 0;
        response = "";
        view.submitted.connect(function (value) { submissions++; response = value; });
        view.activity.connect(function () { activities++; });
        view.retryRequested.connect(function () { retries++; });
        password.forceActiveFocus();
        tryCompare(password, "activeFocus", true);
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

    function test_theme_clock_and_password_privacy() {
        const clock = findChild(view, "lock-clock");
        const date = findChild(view, "lock-date");
        compare(clock.text, Qt.formatTime(fixedDate, Qt.locale().timeFormat(Locale.ShortFormat)));
        compare(String(clock.color), theme.colors.bright_foreground);
        compare(clock.font.family, theme.fonts.ui);
        compare(date.text, Qt.formatDate(fixedDate, "dddd, d MMMM"));
        compare(password.echoMode, TextInput.Password);
        verify(password.inputMethodHints & Qt.ImhSensitiveData);
        verify(password.inputMethodHints & Qt.ImhNoPredictiveText);
        compare(password.Accessible.name, "Password");
    }

    function test_enter_submits_and_clears_secret_immediately() {
        for (const character of "sample password")
            keyClick(character);
        compare(password.text, "sample password");
        keyClick(Qt.Key_Return);
        compare(submissions, 1);
        compare(response, "sample password");
        compare(password.text, "");
        verify(activities > 0);
    }

    function test_mouse_unlock_and_tab_activation() {
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

    function test_escape_only_clears_and_never_submits() {
        password.text = "clear me";
        keyClick(Qt.Key_Escape);
        compare(password.text, "");
        compare(submissions, 0);
        verify(activities > 0);
    }

    function test_busy_disables_submission_and_clears_pending_input() {
        password.text = "discard me";
        view.responseRequired = false;
        view.busy = true;
        compare(password.text, "");
        compare(password.enabled, false);
        compare(submit.enabled, false);
        compare(findChild(view, "lock-status").text, "Authenticating…");
        view.clearInput();
        compare(submissions, 0);
    }

    function test_retry_uses_separate_action_and_current_prompt() {
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
    }
}
