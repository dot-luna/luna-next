import QtQuick
import QtTest
import "../src/shell" as Settings

TestCase {
    id: test
    name: "SettingsAppearance"
    when: windowShown
    visible: true
    width: 1600
    height: 1100

    Component { id: scene; Settings.SettingsView {} }

    function snapshot(rounding, borderWidth) {
        return {
            name: "custom",
            colors: { mode: "light", background: "#eeeeee", dark_background: "#dddddd", lighter_background: "#ffffff", bright_foreground: "#222222", foreground: "#444444", muted: "#aaaaaa", accent: "#cc6622", accent_foreground: "#ffffff", error: "#cc2222", secondary_accent: "#aa44dd", success: "#338844", warning: "#bb9922", selection: "#ffddbb", selection_foreground: "#331100" },
            fonts: { ui: "serif", mono: "monospace" },
            appearance: { rounding: rounding, border_width: borderWidth, gaps: { inner: 7, outer: 11 }, opacity: { active: 0.7, inactive: 0.5, fullscreen: 1 }, blur: { enabled: false } }
        };
    }
    function createView() {
        const view = createTemporaryObject(scene, test, { width: 1000, height: 850, themeSnapshot: snapshot(0, 1) });
        verify(view !== null);
        verify(waitForRendering(view));
        return view;
    }
    function control(view, name) {
        const item = findChild(view, name);
        verify(item !== null, name);
        return item;
    }
    function click(item) { mouseClick(item, item.width / 2, item.height / 2); }
    function typeText(text) { for (const letter of text) keyClick(letter); }

    function test_theme_data() {
        return [{ tag: "square", rounding: 0, borderWidth: 0 }, { tag: "rounded", rounding: 18, borderWidth: 2 }];
    }
    function test_theme(data) {
        const view = createTemporaryObject(scene, test, { width: 1000, height: 850, themeSnapshot: snapshot(data.rounding, data.borderWidth), surfaceOpacity: 0.7 });
        verify(view !== null);
        verify(waitForRendering(view));
        const card = control(view, "theme-custom");
        compare(card.background.radius, data.rounding);
        compare(card.selected, true);
        compare(card.entry.mode, "light");
        compare(control(view, "theme-mode-custom").name, "sun-03");
        compare(control(view, "theme-mode-Moonlight").name, "moon-02");
        compare(control(view, "palette-custom-0").color, "#cc6622");
        compare(control(view, "palette-custom-1").color, "#aa44dd");
        compare(control(view, "palette-custom-2").color, "#338844");
        verify(control(view, "styleTitle").font.pixelSize > 13);
        verify(control(view, "backgroundTitle").font.pixelSize > 13);
        verify(control(view, "section-Text").font.pixelSize > 13);
        verify(control(view, "section-More").font.pixelSize > 13);
        verify(control(view, "addThemeButton").flat);
        verify(control(view, "addBackgroundButton").flat);
        compare(control(view, "nav-appearance").background.radius, data.rounding);
        compare(control(view, "nav-appearance").background.color, "#ffddbb");
        const font = control(view, "control-font");
        compare(font.font.family, "serif");
        compare(font.currentText, "serif");
        compare(font.background.radius, data.rounding);
        compare(font.background.border.width, data.borderWidth);
        const surface = control(view, "settingsSurface");
        verify(Math.abs(surface.color.a - 0.7) < 0.01);
        compare(findChild(view, "control-theme"), null);
        compare(findChild(view, "control-animations"), null);
        compare(findChild(view, "mode-dark"), null);
        compare(findChild(view, "resetButton"), null);
        compare(view.mockState.draft.desktop.rounding, data.rounding);
    }
    function test_choices_and_local_apply() {
        const view = createView();
        const moon = control(view, "theme-Moonlight");
        mouseMove(view, 1, 1);
        compare(control(view, "delete-theme-Moonlight").opacity, 0);
        click(moon);
        compare(view.mockState.draft.appearance.theme, "Moonlight");
        verify(moon.activeFocus);
        verify(control(view, "delete-theme-Moonlight").visible);
        verify(control(view, "delete-theme-Moonlight").enabled);
        click(control(view, "delete-theme-Moonlight"));
        compare(findChild(view, "theme-Moonlight"), null);
        compare(view.mockState.draft.appearance.theme, "custom");
        click(control(view, "discardButton"));
        verify(findChild(view, "theme-Moonlight") !== null);
        verify(!control(view, "delete-theme-custom").visible);
        const mountain = control(view, "background-Mountain");
        mountain.forceActiveFocus();
        verify(waitForRendering(view));
        keyClick(Qt.Key_Return);
        compare(mountain.selected, true);
        compare(mountain.applied, false);
        compare(control(view, "background-Dunes").applied, true);
        click(control(view, "applyButton"));
        compare(mountain.applied, true);
        compare(control(view, "background-Dunes").applied, false);
        compare(view.mockState.dirty, false);
        view.mockState.addBackground(mountain.entry.source);
        compare(view.mockState.draft.appearance.backgrounds.length, 6);
    }
    function test_hover_delete_and_keyboard_access() {
        const view = createView();
        const moon = control(view, "theme-Moonlight");
        const removeMoon = control(view, "delete-theme-Moonlight");
        mouseMove(view, 1, 1);
        compare(removeMoon.opacity, 0);
        mouseMove(moon, moon.width / 2, moon.height / 2);
        tryCompare(removeMoon, "opacity", 1);
        compare(moon.selected, false);
        compare(view.mockState.draft.appearance.theme, "custom");
        mouseMove(view, 1, 1);
        tryCompare(removeMoon, "opacity", 0);
        moon.forceActiveFocus(Qt.TabFocusReason);
        tryCompare(removeMoon, "opacity", 1);
        keyClick(Qt.Key_Tab);
        tryCompare(removeMoon, "activeFocus", true);
        keyClick(Qt.Key_Return);
        compare(findChild(view, "theme-Moonlight"), null);
        compare(view.mockState.saved.appearance.theme, "custom");
        const active = control(view, "theme-custom");
        mouseMove(active, active.width / 2, active.height / 2);
        verify(!control(view, "delete-theme-custom").visible);
        verify(!control(view, "delete-background-Dunes").visible);
        const forest = control(view, "background-Forest");
        view.revealItem(forest);
        verify(waitForRendering(view));
        const removeForest = control(view, "delete-background-Forest");
        mouseMove(view, 1, 1);
        compare(removeForest.opacity, 0);
        mouseMove(forest, forest.width / 2, forest.height / 2);
        tryCompare(removeForest, "opacity", 1);
        compare(forest.selected, false);
        click(removeForest);
        compare(findChild(view, "background-Forest"), null);
        compare(view.mockState.draft.appearance.backgrounds.length, 5);
        compare(view.mockState.saved.appearance.backgrounds.length, 6);
        click(control(view, "discardButton"));
        verify(findChild(view, "background-Forest") !== null);
        verify(findChild(view, "theme-Moonlight") !== null);
    }
    function test_repository_dialog() {
        const view = createView();
        view.forceActiveFocus();
        click(control(view, "addThemeButton"));
        const dialog = control(view, "themeRepositoryDialog");
        tryCompare(dialog, "opened", true);
        const field = control(view, "themeRepositoryUrl");
        verify(field.activeFocus);
        field.text = "invalid";
        keyClick(Qt.Key_Return);
        verify(dialog.errorMessage.length > 0);
        compare(dialog.visible, true);
        field.text = "https://github.com/example/sample.git";
        keyClick(Qt.Key_Return);
        tryCompare(dialog, "visible", false);
        verify(findChild(view, "theme-sample") !== null);
        compare(view.mockState.draft.appearance.themes.length, 4);
        click(control(view, "addThemeButton"));
        tryCompare(dialog, "opened", true);
        keyClick(Qt.Key_Escape);
        tryCompare(dialog, "visible", false);
        compare(view.mockState.page, "appearance");
        verify(view.visible);
    }
    function test_navigation_search_and_max_width() {
        const view = createView();
        compare(findChild(view, "nav-desktop"), null);
        view.width = 1600;
        verify(waitForRendering(view));
        const content = control(view, "settingsContent");
        verify(content.width <= 760);
        const point = content.mapToItem(view, 0, 0);
        verify(Math.abs(point.x + content.width / 2 - (191 + (view.width - 191) / 2)) < 2);
        view.focusSetting("lock");
        verify(waitForRendering(view));
        keyClick(Qt.Key_Return);
        compare(view.mockState.page, "lock");
        compare(control(view, "nav-appearance").checked, true);
        keyClick(Qt.Key_Escape);
        compare(view.mockState.page, "appearance");
        keyClick(Qt.Key_K, Qt.ControlModifier);
        typeText("background");
        verify(view.mockState.results.length >= 1);
        keyClick(Qt.Key_Down);
        keyClick(Qt.Key_Return);
        compare(view.mockState.page, "appearance");
        verify(control(view, "background-Dunes").activeFocus);
        view.mockState.setValue("appearance", "scale", "110%");
        click(control(view, "nav-home"));
        compare(view.mockState.page, "home");
        compare(control(view, "changeBar").visible, false);
        compare(control(view, "pageTitle").visible, false);
        compare(view.mockState.groups.length, 0);
        verify(!control(view, "addThemeButton").visible);
    }
    function test_layout_sizes_and_capture() {
        const view = createView();
        for (const size of [[740,560], [1000,850], [1600,1000]]) {
            view.width = size[0];
            view.height = size[1];
            verify(waitForRendering(view));
            const content = control(view, "settingsContent");
            verify(content.width > 0 && content.width <= 760);
            const card = control(view, "theme-Daylight");
            const p = card.mapToItem(content, 0, 0);
            verify(p.x >= 0 && p.x + card.width <= content.width + 1);
        }
        view.width = 1100;
        view.height = 950;
        verify(waitForRendering(view));
        grabImage(view).save("/tmp/luna-settings-appearance.png");
    }
}
