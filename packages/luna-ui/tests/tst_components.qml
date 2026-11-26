pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls.Basic as Controls
import QtTest
import Luna.UI 1.0 as UI

TestCase {
    id: test
    name: "LunaUI"
    when: windowShown
    visible: true
    width: 640
    height: 400

    property var themeSnapshot: snapshot(false, 12, 1)
    UI.Theme { id: uiTheme; snapshot: test.themeSnapshot }
    Component { id: titleComponent; UI.Title { theme: uiTheme; text: "Appearance" } }
    Component { id: subtitleComponent; UI.Subtitle { theme: uiTheme; text: "Style" } }
    Component { id: textComponent; UI.Text { theme: uiTheme; text: "Choose your theme" } }
    Component { id: buttonComponent; UI.Button { theme: uiTheme; text: "Apply" } }
    Component { id: sceneComponent; Item { width: 600; height: 300 } }
    Component { id: badgeComponent; UI.Badge { theme: uiTheme; text: "Applied" } }
    Component { id: dialogComponent; UI.InputDialog { theme: uiTheme; title: "Download"; fieldLabel: "Image URL" } }
    SignalSpy { id: submissions; signalName: "submitted" }
    SignalSpy { id: clicks; signalName: "clicked" }
    SignalSpy { id: triggers; signalName: "triggered" }

    function snapshot(light, rounding, borderWidth) {
        return {
            colors: {
                dark_background: light ? "#dce0e8" : "#16161e",
                error: light ? "#d20f39" : "#f7768e",
                selection: light ? "#ccd0da" : "#283457",
                selection_foreground: light ? "#4c4f69" : "#c0caf5",
                background: light ? "#eff1f5" : "#1a1b26",
                lighter_background: light ? "#e6e9ef" : "#24283b",
                bright_foreground: light ? "#4c4f69" : "#c0caf5",
                foreground: light ? "#5c5f77" : "#a9b1d6",
                muted: light ? "#9ca0b0" : "#414868",
                accent: light ? "#8839ef" : "#7aa2f7",
                accent_foreground: light ? "#eff1f5" : "#1a1b26"
            },
            fonts: {ui: light ? "serif" : "sans-serif"},
            appearance: {rounding: rounding, border_width: borderWidth}
        };
    }
    function init() {
        themeSnapshot = snapshot(false, 12, 1);
        submissions.target = null;
        submissions.clear();
        clicks.target = null;
        triggers.target = null;
        clicks.clear();
        triggers.clear();
        mouseMove(test, test.width - 1, test.height - 1);
    }
    function button(properties) {
        const item = createTemporaryObject(buttonComponent, test, Object.assign({x: 30, y: 100}, properties || {}));
        verify(item !== null);
        verify(waitForRendering(item));
        return item;
    }
    function click(item) { mouseClick(item, item.width / 2, item.height / 2); }

    function test_typography() {
        const title = createTemporaryObject(titleComponent, test);
        const subtitle = createTemporaryObject(subtitleComponent, test);
        const body = createTemporaryObject(textComponent, test);
        verify(title !== null && subtitle !== null && body !== null);
        compare(title.font.pixelSize, 24);
        compare(subtitle.font.pixelSize, 18);
        compare(body.font.pixelSize, 13);
        verify(title.font.weight > subtitle.font.weight);
        verify(subtitle.font.weight > body.font.weight);
        for (const item of [title, subtitle, body]) {
            compare(item.font.family, uiTheme.font);
            compare(item.textFormat, Text.PlainText);
            compare(item.wrapMode, Text.WordWrap);
        }
        compare(title.color, uiTheme.text);
        compare(subtitle.color, uiTheme.subtle);
        compare(body.color, uiTheme.text);
        body.text = "<b>Plain text</b>";
        compare(body.textFormat, Text.PlainText);
        body.font.pixelSize = 18;
        body.color = "#ff9933";
        compare(body.font.pixelSize, 18);
        compare(body.color, "#ff9933");
    }

    function test_theme_data() {
        return [
            {tag: "dark-rounded", light: false, rounding: 14, borderWidth: 2},
            {tag: "light-square", light: true, rounding: 0, borderWidth: 0}
        ];
    }
    function test_theme(data) {
        themeSnapshot = snapshot(data.light, data.rounding, data.borderWidth);
        const primary = button();
        const secondary = button({variant: UI.Button.Secondary, x: 150});
        const outline = button({variant: UI.Button.Outline, x: 270});
        const ghost = button({variant: UI.Button.Ghost, x: 390});
        compare(primary.background.color, uiTheme.accent);
        compare(primary.contentItem.color, uiTheme.accentText);
        compare(secondary.background.color, uiTheme.raised);
        compare(outline.background.color, "#00000000");
        compare(outline.background.border.width, Math.max(1, data.borderWidth));
        compare(outline.background.border.color, uiTheme.line);
        compare(ghost.background.color, "#00000000");
        compare(ghost.background.border.width, 0);
        for (const item of [primary, secondary, outline, ghost]) {
            compare(item.background.radius, data.rounding);
            compare(item.font.family, uiTheme.font);
            compare(item.Accessible.name, "Apply");
            compare(item.Accessible.role, Accessible.Button);
            verify(item.contentItem.Accessible.ignored);
            verify(item.width >= 80 && item.height >= 36);
        }
    }

    function test_explicit_snapshot_update_restyles_existing_controls() {
        const title = createTemporaryObject(titleComponent, test);
        const item = button({variant: UI.Button.Outline});
        themeSnapshot = snapshot(true, 0, 3);
        compare(title.color, uiTheme.text);
        compare(title.font.family, "serif");
        compare(item.font.family, "serif");
        compare(item.background.radius, 0);
        compare(item.background.border.width, 3);
        compare(item.background.border.color, uiTheme.line);
        compare(item.contentItem.color, uiTheme.text);
    }

    function test_activation_data() {
        return [
            {tag: "primary", variant: UI.Button.Primary},
            {tag: "secondary", variant: UI.Button.Secondary},
            {tag: "outline", variant: UI.Button.Outline},
            {tag: "ghost", variant: UI.Button.Ghost}
        ];
    }
    function test_activation(data) {
        const item = button({variant: data.variant});
        clicks.target = item;
        item.forceActiveFocus(Qt.TabFocusReason);
        verify(item.visualFocus);
        verify(item.background.children[0].visible);
        keyClick(Qt.Key_Space);
        compare(clicks.count, 1);
        keyClick(Qt.Key_Return);
        compare(clicks.count, 2);
        keyClick(Qt.Key_Enter);
        compare(clicks.count, 3);
        click(item);
        compare(clicks.count, 4);
        mousePress(item, item.width / 2, item.height / 2);
        mouseMove(test, test.width - 1, test.height - 1);
        mouseRelease(test, test.width - 1, test.height - 1);
        compare(clicks.count, 4);
    }

    function test_keyboard_activates_action_and_checkable_state() {
        const action = Qt.createQmlObject('import QtQuick.Controls.Basic; Action { text: "Save"; checkable: true }', test);
        const item = button({action: action});
        triggers.target = action;
        clicks.target = item;
        item.forceActiveFocus(Qt.TabFocusReason);
        keyClick(Qt.Key_Return);
        compare(clicks.count, 1);
        compare(triggers.count, 1);
        verify(action.checked);
        verify(item.checked);
        keyClick(Qt.Key_Space);
        compare(clicks.count, 2);
        compare(triggers.count, 2);
        verify(!action.checked);
        action.destroy();
    }

    function test_disabled_data() { return test_activation_data(); }
    function test_disabled(data) {
        const item = button({variant: data.variant});
        clicks.target = item;
        item.forceActiveFocus();
        item.enabled = false;
        keyClick(Qt.Key_Return);
        keyClick(Qt.Key_Enter);
        keyClick(Qt.Key_Space);
        click(item);
        compare(clicks.count, 0);
        compare(item.opacity, 0.45);
        verify(!item.background.children[0].visible);
    }

    function test_keyboard_navigation_skips_disabled_buttons() {
        const scene = createTemporaryObject(sceneComponent, test, {x: 10, y: 10});
        const first = createTemporaryObject(buttonComponent, scene, {x: 20, y: 60});
        createTemporaryObject(buttonComponent, scene, {x: 140, y: 60, enabled: false});
        const last = createTemporaryObject(buttonComponent, scene, {x: 260, y: 60});
        verify(waitForRendering(scene));
        first.forceActiveFocus(Qt.TabFocusReason);
        keyClick(Qt.Key_Tab);
        tryCompare(last, "activeFocus", true);
        keyClick(Qt.Key_Backtab);
        tryCompare(first, "activeFocus", true);
    }

    function test_hover_and_press_never_delay_actions() {
        const item = button({variant: UI.Button.Ghost});
        clicks.target = item;
        compare(item.background.color, "#00000000");
        mouseMove(item, item.width / 2, item.height / 2);
        tryCompare(item, "hovered", true);
        tryCompare(item.background, "color", uiTheme.raised);
        mousePress(item, item.width / 2, item.height / 2);
        verify(item.down);
        compare(clicks.count, 0);
        mouseRelease(item, item.width / 2, item.height / 2);
        compare(clicks.count, 1);
        mouseMove(test, test.width - 1, test.height - 1);
        tryCompare(item.background, "color", "#00000000");
    }

    function test_badge_variants_data() { return test_theme_data(); }
    function test_badge_variants(data) {
        themeSnapshot = snapshot(data.light, data.rounding, data.borderWidth);
        for (const variant of [UI.Badge.Primary, UI.Badge.Secondary, UI.Badge.Outline, UI.Badge.Destructive]) {
            const badge = createTemporaryObject(badgeComponent, test, {variant: variant});
            compare(badge.radius, data.rounding);
            compare(badge.Accessible.name, "Applied");
            verify(badge.width > 0 && badge.height > 0);
            if (variant === UI.Badge.Primary) compare(badge.color, uiTheme.accent);
            if (variant === UI.Badge.Secondary) compare(badge.color, uiTheme.surface);
            if (variant === UI.Badge.Destructive) compare(badge.color, uiTheme.error);
            if (variant === UI.Badge.Outline) {
                compare(badge.color, "#00000000");
                compare(badge.border.width, Math.max(1, data.borderWidth));
            }
        }
    }
    function test_input_dialog_submission_busy_errors_and_dismissal() {
        const dialog = createTemporaryObject(dialogComponent, test);
        submissions.target = dialog;
        dialog.open();
        const input = findChild(dialog, "dialogInput");
        verify(dialog.visible);
        verify(input.activeFocus);
        tryCompare(dialog, "opened", true);
        const submit = findChild(dialog, "dialogSubmit");
        verify(input.activeFocus);
        verify(!submit.enabled);
        keyClick(Qt.Key_Return);
        compare(submissions.count, 0);
        input.text = "  https://example.com/wallpaper.jpg  ";
        keyClick(Qt.Key_Return);
        compare(submissions.count, 1);
        compare(submissions.signalArguments[0][0], "https://example.com/wallpaper.jpg");
        verify(dialog.visible);
        dialog.errorMessage = "Try another URL";
        verify(findChild(dialog, "dialogError").visible);
        dialog.busy = true;
        verify(!submit.enabled);
        keyClick(Qt.Key_Return);
        compare(submissions.count, 1);
        keyClick(Qt.Key_Escape);
        tryCompare(dialog, "visible", false);
        dialog.busy = false;
        dialog.open();
        tryCompare(dialog, "opened", true);
        compare(dialog.text, "");
        compare(dialog.errorMessage, "");
        dialog.close();
    }
    function test_sizing_and_overrides() {
        const item = button({text: "A longer button label that needs more space"});
        verify(item.width >= item.contentItem.implicitWidth + item.leftPadding + item.rightPadding);
        item.width = 100;
        compare(item.contentItem.elide, Text.ElideRight);
        verify(item.contentItem.truncated);
        item.height = 48;
        item.font.pixelSize = 18;
        compare(item.height, 48);
        compare(item.contentItem.font.pixelSize, 18);
    }
}
