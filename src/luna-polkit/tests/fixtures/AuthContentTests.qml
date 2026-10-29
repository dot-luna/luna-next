import QtQuick
import QtQuick.Window
import QtTest
import Quickshell
import "../../src/shell" as Polkit

TestCase {
    id: tests
    name: "AuthenticationContent"
    visible: true

    readonly property var theme: JSON.parse(Quickshell.env("LUNA_NEXT_POLKIT_THEME"))
    property var flow
    property var card
    property var input
    property var identitySelector
    property var cancelButton
    property var authenticateButton
    property var failedTests: []
    property url dialogSource

    Component {
        id: flowComponent

        // QObject properties provide the same change notifications as native flows.
        QtObject {
            property string message: "Authentication is needed to change a setting."
            property string actionId: "org.example.lunanext.test"
            property var identities: [
                {string: "alice", displayName: "Alice", isGroup: false, id: 1000},
                {string: "root", displayName: "Administrator", isGroup: false, id: 0}
            ]
            property var selectedIdentity: identities[0]
            property bool isResponseRequired: true
            property string inputPrompt: "Password:"
            property bool responseVisible: false
            property string supplementaryMessage: ""
            property bool supplementaryIsError: false
            property bool isCompleted: false
            property bool isCancelled: false
            property bool isSuccessful: false
            property bool failed: false
            property var responses: []
            property int cancellations: 0
            property bool delayResponseChange: false

            signal authenticationFailed()
            signal authenticationSucceeded()
            signal authenticationRequestCancelled()

            function submit(value) {
                responses = responses.concat([value]);
                if (!delayResponseChange)
                    isResponseRequired = false;
            }

            function cancelAuthenticationRequest() {
                cancellations++;
                isCancelled = true;
                isCompleted = true;
                authenticationRequestCancelled();
            }
        }
    }

    Component {
        id: contentComponent

        Polkit.AuthContent {
            width: implicitWidth
            height: implicitHeight
        }
    }

    function init() {
        flow = createTemporaryObject(flowComponent, tests);
        card = createTemporaryObject(contentComponent, tests, {flow: flow, theme: theme});
        verify(card !== null);
        input = findChild(card, "responseInput");
        identitySelector = findChild(card, "identitySelector");
        cancelButton = findChild(card, "cancelButton");
        authenticateButton = findChild(card, "authenticateButton");
        verify(input && identitySelector && cancelButton && authenticateButton);
        wait(0);
        card.focusInput();
        tryCompare(input, "activeFocus", true);
    }

    function cleanup() {
        // Quickshell owns Qt's logger; expose failures and final counts explicitly.
        if (qtest_results.failed)
            failedTests = failedTests.concat([qtest_results.functionName]);
    }

    function cleanupTestCase() {
        console.log("LUNA_NEXT_POLKIT_TEST_RESULT " + JSON.stringify({
            passed: qtest_results.passCount,
            failed: qtest_results.failCount,
            skipped: qtest_results.skipCount,
            failedTests: failedTests
        }));
    }

    function typeSecret() {
        input.forceActiveFocus();
        const secret = "secret";
        for (let index = 0; index < secret.length; index++)
            keyClick(secret[index]);
        compare(input.text, secret);
    }

    function verifyFocusCycle(controls) {
        controls[0].forceActiveFocus();
        for (let index = 1; index <= controls.length; index++) {
            keyClick(Qt.Key_Tab);
            tryCompare(controls[index % controls.length], "activeFocus", true);
        }
        for (let index = controls.length - 1; index >= 0; index--) {
            keyClick(Qt.Key_Backtab);
            tryCompare(controls[index], "activeFocus", true);
        }
    }

    function openAccountMenu(key, modifiers = Qt.NoModifier) {
        identitySelector.forceActiveFocus();
        keyClick(key, modifiers);
        tryCompare(identitySelector.popup, "opened", true);
        compare(flow.cancellations, 0);
        compare(flow.responses.length, 0);
    }

    function verifyUndoCannotRestoreSecret() {
        // An echoing PAM challenge must never reveal the previous password.
        flow.responseVisible = true;
        compare(input.text, "");
        compare(input.canUndo, false);
        compare(input.canRedo, false);
        input.undo();
        compare(input.text, "");
        input.redo();
        compare(input.text, "");
        flow.isCompleted = false;
        flow.isResponseRequired = true;
        input.forceActiveFocus();
        keyClick(Qt.Key_Z, Qt.ControlModifier);
        compare(input.text, "");
        compare(input.canUndo, false);
        compare(input.canRedo, false);
    }

    function test_submit_erases_password_undo_history() {
        typeSecret();
        card.submitResponse();
        verifyUndoCannotRestoreSecret();
    }

    function test_cancel_erases_password_undo_history() {
        typeSecret();
        card.cancel();
        verifyUndoCannotRestoreSecret();
    }

    function test_identity_change_erases_password_undo_history() {
        typeSecret();
        card.selectIdentity(1);
        verifyUndoCannotRestoreSecret();
    }

    function test_flow_replacement_erases_password_undo_history() {
        typeSecret();
        flow = createTemporaryObject(flowComponent, tests);
        card.flow = flow;
        verifyUndoCannotRestoreSecret();
    }

    function test_retry_erases_password_undo_history() {
        typeSecret();
        flow.authenticationFailed();
        verifyUndoCannotRestoreSecret();
    }

    function test_external_cancellation_erases_password_undo_history() {
        typeSecret();
        flow.authenticationRequestCancelled();
        verifyUndoCannotRestoreSecret();
    }

    function test_success_erases_password_undo_history() {
        typeSecret();
        flow.authenticationSucceeded();
        verifyUndoCannotRestoreSecret();
    }

    function test_completed_request_erases_password_undo_history() {
        typeSecret();
        flow.isCompleted = true;
        verifyUndoCannotRestoreSecret();
    }

    function test_visible_response_cleanup_erases_existing_undo_history() {
        flow.responseVisible = true;
        typeSecret();
        verify(input.canUndo);
        card.submitResponse();
        verifyUndoCannotRestoreSecret();
    }

    function typeAndEraseSecret() {
        typeSecret();
        keyClick(Qt.Key_A, Qt.ControlModifier);
        keyClick(Qt.Key_Backspace);
        compare(input.text, "");
        verify(input.canUndo);
    }

    function test_empty_field_identity_change_erases_undo_history() {
        typeAndEraseSecret();
        card.selectIdentity(1);
        verifyUndoCannotRestoreSecret();
    }

    function test_empty_field_flow_replacement_erases_undo_history() {
        typeAndEraseSecret();
        flow = createTemporaryObject(flowComponent, tests);
        card.flow = flow;
        verifyUndoCannotRestoreSecret();
    }

    function test_empty_field_cancel_erases_undo_history() {
        typeAndEraseSecret();
        card.cancel();
        verifyUndoCannotRestoreSecret();
    }

    function test_empty_field_submit_erases_undo_history() {
        typeAndEraseSecret();
        card.submitResponse();
        compare(flow.responses.length, 1);
        compare(flow.responses[0], "");
        verifyUndoCannotRestoreSecret();
    }

    function test_empty_field_identity_change_erases_redo_history() {
        flow.responseVisible = true;
        typeSecret();
        input.undo();
        compare(input.text, "");
        compare(input.canUndo, false);
        verify(input.canRedo);
        card.selectIdentity(1);
        verifyUndoCannotRestoreSecret();
    }

    function test_short_dialog_keeps_keyboard_controls_inside_viewport() {
        flow.message = Array(30).fill("A long administrator request needs your authentication.").join(" ");
        const component = Qt.createComponent(dialogSource);
        compare(component.status, Component.Ready, component.errorString());
        const dialog = createTemporaryObject(component, tests, {flow: flow, theme: theme, width: 480, height: 260});
        verify(dialog !== null);
        dialog.requestActivate();
        tryCompare(dialog, "active", true);
        const response = findChild(dialog, "responseInput");
        verify(response !== null);
        let viewport = response.parent;
        while (viewport && viewport.contentY === undefined)
            viewport = viewport.parent;
        verify(viewport !== null);
        verify(viewport.contentHeight > viewport.height);

        response.forceActiveFocus();
        const controls = ["responseInput", "cancelButton", "authenticateButton", "identitySelector"];
        for (let index = 0; index < controls.length; index++) {
            const control = findChild(dialog, controls[index]);
            tryCompare(control, "activeFocus", true);
            tryVerify(() => {
                const top = control.mapToItem(viewport, 0, 0).y;
                return top >= 0 && top + control.height <= viewport.height;
            }, 1000, controls[index] + " must scroll into view");
            if (index < controls.length - 1)
                keyClick(Qt.Key_Tab);
        }
        dialog.close();
        tests.Window.window.requestActivate();
    }

    function test_secret_and_visible_challenge_follow_pam_prompt() {
        input.text = "hidden-response";
        compare(input.echoMode, TextInput.Password);
        compare(input.passwordMaskDelay, 0);
        verify(input.displayText !== input.text);
        verify(input.inputMethodHints & Qt.ImhSensitiveData);
        verify(input.inputMethodHints & Qt.ImhNoPredictiveText);

        flow.isResponseRequired = false;
        flow.responseVisible = true;
        flow.inputPrompt = "One-time challenge:";
        flow.isResponseRequired = true;
        compare(input.text, "");
        input.text = "001234";
        compare(input.echoMode, TextInput.Normal);
        compare(input.displayText, "001234");
        compare(input.Accessible.name, "One-time challenge:");
    }

    function test_submit_preserves_response_and_rejects_duplicate_while_busy() {
        const response = "  Pass '雪' $() ";
        input.text = response;
        card.submitResponse();
        compare(flow.responses.length, 1);
        compare(flow.responses[0], response);
        compare(input.text, "");
        compare(input.enabled, false);
        compare(authenticateButton.enabled, false);
        input.text = "stale";
        card.submitResponse();
        compare(flow.responses.length, 1);
    }

    function test_multistep_challenge_never_reuses_previous_password() {
        typeSecret();
        card.submitResponse();
        flow.inputPrompt = "One-time code:";
        flow.responseVisible = true;
        flow.isResponseRequired = true;
        tryCompare(input, "activeFocus", true);
        compare(input.text, "");
        compare(input.canUndo, false);
        compare(input.canRedo, false);
        compare(input.echoMode, TextInput.Normal);
        input.text = "001234";
        card.submitResponse();
        compare(flow.responses.length, 2);
        compare(flow.responses[0], "secret");
        compare(flow.responses[1], "001234");
        compare(input.text, "");
        verifyUndoCannotRestoreSecret();
    }

    function test_submit_guard_handles_delayed_backend_notification() {
        flow.delayResponseChange = true;
        input.text = "first";
        card.submitResponse();
        input.text = "duplicate";
        card.submitResponse();
        compare(flow.responses.length, 1);
        compare(flow.responses[0], "first");
        compare(authenticateButton.enabled, false);
    }

    function test_empty_response_is_forwarded_for_pam_to_validate() {
        card.submitResponse();
        compare(flow.responses.length, 1);
        compare(flow.responses[0], "");
    }

    function test_cancel_clears_secret_without_submitting() {
        input.text = "discard me";
        card.cancel();
        compare(input.text, "");
        compare(flow.responses.length, 0);
        compare(flow.cancellations, 1);
        compare(flow.isCancelled, true);
        card.cancel();
        compare(flow.cancellations, 1);
    }

    function test_identity_change_clears_previous_secret() {
        input.text = "alice secret";
        card.selectIdentity(1);
        compare(flow.selectedIdentity, flow.identities[1]);
        compare(identitySelector.currentIndex, 1);
        compare(input.text, "");
        compare(flow.responses.length, 0);

        input.text = "root secret";
        flow.selectedIdentity = flow.identities[0];
        compare(input.text, "");
        compare(identitySelector.currentIndex, 0);
        card.selectIdentity(-1);
        card.selectIdentity(99);
        compare(flow.selectedIdentity, flow.identities[0]);
    }

    function test_flow_replacement_detaches_old_request_and_clears_secret() {
        input.text = "old secret";
        const previous = flow;
        flow = createTemporaryObject(flowComponent, tests);
        card.flow = flow;
        compare(input.text, "");
        input.text = "new secret";
        previous.authenticationRequestCancelled();
        compare(input.text, "new secret");
        compare(flow.cancellations, 0);

        card.flow = null;
        compare(input.text, "");
        compare(input.enabled, false);
        card.submitResponse();
        card.cancel();
        compare(flow.responses.length, 0);
        compare(flow.cancellations, 0);
    }

    function test_failure_clears_secret_and_allows_retry() {
        input.text = "wrong secret";
        card.submitResponse();
        flow.authenticationFailed();
        flow.isResponseRequired = true;
        compare(input.text, "");
        verify(findChild(card, "feedback").text.indexOf("try again") !== -1);
        tryCompare(input, "activeFocus", true);
        input.text = "new attempt";
        card.submitResponse();
        compare(flow.responses.length, 2);
        compare(flow.responses[1], "new attempt");
        compare(input.text, "");
    }

    function test_success_and_external_cancellation_clear_secret() {
        input.text = "successful secret";
        flow.authenticationSucceeded();
        compare(input.text, "");
        input.text = "cancelled secret";
        flow.authenticationRequestCancelled();
        compare(input.text, "");
        input.text = "completed secret";
        flow.isCompleted = true;
        compare(input.text, "");
        compare(input.enabled, false);
        card.submitResponse();
        compare(flow.responses.length, 0);
    }

    function test_supplementary_feedback_is_plain_text() {
        flow.supplementaryMessage = "<b>Token expired</b> & try again";
        flow.supplementaryIsError = true;
        const feedback = findChild(card, "feedback");
        compare(feedback.text, flow.supplementaryMessage);
        compare(feedback.textFormat, Text.PlainText);
        compare(feedback.visible, true);
        compare(flow.responses.length, 0);
    }

    function test_keyboard_enter_submits_and_escape_cancels() {
        input.text = "enter response";
        keyClick(Qt.Key_Return);
        compare(flow.responses.length, 1);
        compare(flow.responses[0], "enter response");
        compare(input.text, "");

        flow.isResponseRequired = true;
        card.focusInput();
        input.text = "cancel response";
        keyClick(Qt.Key_Escape);
        compare(flow.cancellations, 1);
        compare(input.text, "");
        compare(flow.responses.length, 1);
    }

    function test_keyboard_tab_traverses_accounts_and_actions() {
        verifyFocusCycle([input, cancelButton, authenticateButton, identitySelector]);
    }

    function test_keyboard_account_selection_clears_previous_secret() {
        input.text = "first account secret";
        identitySelector.forceActiveFocus();
        keyClick(Qt.Key_Down);
        compare(flow.selectedIdentity, flow.identities[1]);
        compare(identitySelector.currentIndex, 1);
        compare(identitySelector.currentText, "Administrator (root)");
        compare(input.text, "");
        compare(flow.responses.length, 0);
    }

    function test_single_identity_does_not_add_an_empty_tab_stop() {
        flow.identities = [flow.identities[0]];
        compare(identitySelector.visible, false);
        verifyFocusCycle([input, cancelButton, authenticateButton]);
    }

    function test_busy_request_tab_cycle_keeps_cancel_and_account_accessible() {
        typeSecret();
        keyClick(Qt.Key_Return);
        tryCompare(cancelButton, "activeFocus", true);
        compare(input.enabled, false);
        compare(authenticateButton.enabled, false);
        verifyFocusCycle([cancelButton, identitySelector]);
        keyClick(Qt.Key_Escape);
        compare(flow.cancellations, 1);
        compare(flow.responses.length, 1);
    }

    function test_busy_single_account_keeps_focus_on_cancel() {
        flow.identities = [flow.identities[0]];
        typeSecret();
        keyClick(Qt.Key_Return);
        tryCompare(cancelButton, "activeFocus", true);
        verifyFocusCycle([cancelButton]);
        keyClick(Qt.Key_Space);
        compare(flow.cancellations, 1);
        compare(flow.responses.length, 1);
    }

    function test_keyboard_space_opens_accounts_and_enter_selects() {
        input.text = "first account secret";
        openAccountMenu(Qt.Key_Space);
        keyClick(Qt.Key_Down);
        keyClick(Qt.Key_Return);
        tryCompare(identitySelector.popup, "opened", false);
        compare(flow.selectedIdentity, flow.identities[1]);
        compare(input.text, "");
        tryCompare(input, "activeFocus", true);
        compare(flow.responses.length, 0);
        verifyUndoCannotRestoreSecret();
    }

    function test_keyboard_enter_opens_accounts_without_submitting() {
        openAccountMenu(Qt.Key_Return);
        keyClick(Qt.Key_Escape);
        tryCompare(identitySelector.popup, "opened", false);
        compare(flow.cancellations, 0);
        compare(flow.responses.length, 0);
    }

    function test_keyboard_keypad_enter_opens_and_confirms_account() {
        typeSecret();
        openAccountMenu(Qt.Key_Enter);
        keyClick(Qt.Key_Down);
        keyClick(Qt.Key_Enter);
        tryCompare(identitySelector.popup, "opened", false);
        compare(flow.selectedIdentity, flow.identities[1]);
        compare(input.text, "");
        tryCompare(input, "activeFocus", true);
        compare(flow.responses.length, 0);
    }

    function test_keyboard_alt_down_opens_accounts_without_changing_selection() {
        openAccountMenu(Qt.Key_Down, Qt.AltModifier);
        compare(flow.selectedIdentity, flow.identities[0]);
        keyClick(Qt.Key_Escape);
        tryCompare(identitySelector.popup, "opened", false);
        compare(flow.cancellations, 0);
    }

    function test_escape_closes_account_menu_before_cancelling_dialog() {
        typeSecret();
        openAccountMenu(Qt.Key_Space);
        keyClick(Qt.Key_Down);
        keyClick(Qt.Key_Escape);
        tryCompare(identitySelector.popup, "opened", false);
        compare(flow.cancellations, 0);
        compare(flow.selectedIdentity, flow.identities[0]);
        compare(input.text, "secret");
        keyClick(Qt.Key_Escape);
        compare(flow.cancellations, 1);
        compare(input.text, "");
        compare(flow.responses.length, 0);
    }

    function test_mouse_account_selection_clears_secret_and_refocuses_input() {
        typeSecret();
        mouseClick(identitySelector);
        tryCompare(identitySelector.popup, "opened", true);
        const list = identitySelector.popup.contentItem;
        tryVerify(() => list.itemAtIndex(1) !== null);
        verify(waitForRendering(list));
        mouseClick(list.itemAtIndex(1));
        tryCompare(identitySelector.popup, "opened", false);
        compare(flow.selectedIdentity, flow.identities[1]);
        compare(input.text, "");
        tryCompare(input, "activeFocus", true);
        compare(flow.cancellations, 0);
        compare(flow.responses.length, 0);
        verifyUndoCannotRestoreSecret();
    }

    function test_mouse_authenticate_submits_once_and_clears_secret() {
        typeSecret();
        mouseClick(authenticateButton);
        compare(flow.responses.length, 1);
        compare(flow.responses[0], "secret");
        compare(input.text, "");
        compare(authenticateButton.enabled, false);
        mouseClick(authenticateButton);
        compare(flow.responses.length, 1);
        verifyUndoCannotRestoreSecret();
    }

    function test_mouse_cancel_discards_secret_without_submitting() {
        typeSecret();
        mouseClick(cancelButton);
        compare(flow.cancellations, 1);
        compare(flow.responses.length, 0);
        compare(input.text, "");
        verifyUndoCannotRestoreSecret();
    }

    function test_keyboard_space_authenticates_focused_button() {
        typeSecret();
        authenticateButton.forceActiveFocus();
        keyClick(Qt.Key_Space);
        compare(flow.responses.length, 1);
        compare(flow.responses[0], "secret");
        compare(input.text, "");
        compare(flow.cancellations, 0);
    }

    function test_keyboard_return_cancels_focused_button_without_submitting() {
        typeSecret();
        cancelButton.forceActiveFocus();
        keyClick(Qt.Key_Return);
        compare(flow.cancellations, 1);
        compare(flow.responses.length, 0);
        compare(input.text, "");
    }

    function test_keyboard_space_cancels_focused_button_without_submitting() {
        typeSecret();
        cancelButton.forceActiveFocus();
        keyClick(Qt.Key_Space);
        compare(flow.cancellations, 1);
        compare(flow.responses.length, 0);
        compare(input.text, "");
    }

    function test_keyboard_authenticate_button_and_busy_cancel() {
        input.text = "button response";
        authenticateButton.forceActiveFocus();
        keyClick(Qt.Key_Enter);
        compare(flow.responses.length, 1);
        compare(flow.responses[0], "button response");
        card.focusInput();
        tryCompare(cancelButton, "activeFocus", true);
        keyClick(Qt.Key_Return);
        compare(flow.cancellations, 1);
        compare(flow.responses.length, 1);
    }
}
