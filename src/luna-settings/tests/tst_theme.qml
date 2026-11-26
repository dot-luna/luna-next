pragma ComponentBehavior: Bound

import QtQuick
import Luna.UI 1.0 as UI
import QtTest
import "../src/shell" as Settings

TestCase {
    id: test
    name: "SettingsAppearance"
    when: windowShown
    visible: true
    width: 1600
    height: 1100

    QtObject {
        id: backgroundService
        property var entries: []
        property bool busy: false
        property string errorMessage: ""
        readonly property string operation: lastOperation
        property string lastOperation: ""
        signal finished(string action, bool success)
        function reset() {
            entries = ["Dunes", "Mountain", "Forest", "Coast", "Bloom", "Aurora"].map((name, index) => ({
                name: name, source: Qt.resolvedUrl("fixtures/backgrounds/" + name.toLowerCase() + ".svg").toString(), current: index === 0, video: false
            }));
            busy = false;
            errorMessage = "";
            lastOperation = "";
        }
        function run(action, value) {
            lastOperation = action;
            if (action === "select" || action === "random") {
                const chosen = action === "random" ? entries.find(entry => !entry.current).name : value;
                entries = entries.map(entry => Object.assign({}, entry, {current: entry.name === chosen}));
            } else if (action === "remove") entries = entries.filter(entry => entry.name !== value);
            else if (action === "install") {
                if (value === "invalid") { errorMessage = "Invalid wallpaper URL"; finished(action, false); return; }
                entries = entries.concat([{name: "Installed", source: Qt.resolvedUrl("fixtures/backgrounds/bloom.svg").toString(), current: false, video: false}]);
            }
            errorMessage = "";
            finished(action, true);
        }
    }
    QtObject {
        id: themeService
        property var entries: []
        property var preview: null
        property bool busy: false
        property string errorMessage: ""
        property string lastOperation: ""
        property string installedName: ""
        signal finished(string action, bool success)
        function card(name, mode, accent, current) {
            return { name: name, mode: mode, current: current, background: "#eeeeee", foreground: "#222222", raised: "#ffffff", dark: "#dddddd", accent: accent, palette: [accent, "#aa44dd", "#338844", "#bb9922", "#cc2222", "#444444"] };
        }
        function reset() {
            entries = [card("custom", "light", "#cc6622", true), card("Moonlight", "dark", "#82aaff", false), card("Daylight", "light", "#6172b0", false)];
            busy = false; errorMessage = ""; preview = null; lastOperation = ""; installedName = "";
        }
        function run(action, value, name, fingerprint) {
            lastOperation = action;
            errorMessage = "";
            if (action === "preview") {
                if (value === "invalid") { errorMessage = "Invalid theme URL"; finished(action, false); return; }
                preview = { suggestedName: "sample", needsName: true, remote: true, fingerprint: "reviewed", files: [{path: "theme.jsonc"}, {path: "wallpapers/night.jpg"}], wallpapers: ["wallpapers"], fonts: {ui: "Outfit", mono: "Iosevka"}, packages: [{name: "ttf-outfit", source: "aur", installed: false}] };
            } else if (action === "install") {
                installedName = name;
                entries = entries.concat([card(name, "dark", "#55aaff", false)]);
            } else if (action === "select" || action === "random") {
                const chosen = action === "random" ? entries.find(entry => !entry.current).name : value;
                entries = entries.map(entry => Object.assign({}, entry, {current: entry.name === chosen}));
            } else if (action === "remove") entries = entries.filter(entry => entry.name !== value);
            finished(action, true);
        }
    }
    function init() { backgroundService.reset(); themeService.reset(); }
    Component { id: scene; Settings.SettingsView { backgrounds: backgroundService; themes: themeService } }

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
        verify(waitForPolish(view));
        verify(waitForRendering(view));
        return view;
    }
    function control(view, name) {
        const item = findChild(view, name);
        verify(item !== null, name);
        return item;
    }
    function click(item) {
        verify(waitForPolish(item));
        mouseMove(item, item.width / 2, item.height / 2);
        tryCompare(item, "hovered", true);
        mouseClick(item, item.width / 2, item.height / 2);
    }
    function typeText(text) { for (const letter of text) keyClick(letter); }

    function test_theme_data() {
        return [{ tag: "square", rounding: 0, borderWidth: 0 }, { tag: "rounded", rounding: 18, borderWidth: 2 }];
    }
    function test_theme(data) {
        const view = createTemporaryObject(scene, test, { width: 1000, height: 850, themeSnapshot: snapshot(data.rounding, data.borderWidth), surfaceOpacity: 0.7 });
        verify(view !== null);
        verify(waitForPolish(view));
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
        verify(control(view, "themeTitle").font.pixelSize > 13);
        compare(control(view, "backgroundTitle").font.pixelSize, 18);
        const random = control(view, "randomBackground");
        compare(random.variant, UI.Button.Ghost);
        compare(random.text, "");
        compare(random.Accessible.name, "Random wallpaper");
        const randomPoint = random.mapToItem(view, 0, 0);
        const titlePoint = control(view, "backgroundTitle").mapToItem(view, 0, 0);
        verify(randomPoint.x > titlePoint.x && Math.abs(randomPoint.y - titlePoint.y) < 20);
        verify(control(view, "section-Text").font.pixelSize > 13);
        verify(control(view, "section-More").font.pixelSize > 13);
        compare(control(view, "randomTheme").variant, UI.Button.Ghost);
        verify(control(view, "themeImportTile").visible);
        compare(findChild(view, "addBackgroundButton"), null);
        verify(control(view, "headerDivider").visible);
        verify(control(view, "pageTitle").visible);
        compare(control(view, "pageTitle").text, "Appearance");
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
    function test_applied_badge_draws_above_the_wallpaper() {
        const view = createView();
        const card = control(view, "background-Dunes");
        compare(card.contentItem.x, 0);
        compare(card.contentItem.y, 0);
        compare(card.contentItem.width, card.width);
        compare(card.contentItem.height, card.height);
        view.revealItem(card);
        verify(waitForPolish(view));
        tryCompare(control(card, "backgroundPreview"), "status", Image.Ready);
        const badge = control(card, "applied-background-Dunes");
        const point = badge.mapToItem(view, 2, 2);
        compare(grabImage(view).pixel(Math.floor(point.x), Math.floor(point.y)), "#eeeeee");
    }
    function test_choices_apply_backgrounds_immediately() {
        const view = createView();
        const mountain = control(view, "background-Mountain");
        view.revealItem(mountain);
        mountain.forceActiveFocus();
        verify(waitForPolish(view));
        keyClick(Qt.Key_Return);
        compare(control(view, "background-Mountain").applied, true);
        compare(control(view, "background-Dunes").applied, false);
        verify(control(view, "applied-background-Mountain").visible);
        compare(findChild(view, "applyButton"), null);
        compare(findChild(view, "discardButton"), null);
        compare(backgroundService.lastOperation, "select");
        const random = control(view, "randomBackground");
        view.revealItem(random);
        verify(waitForPolish(view));
        click(random);
        compare(backgroundService.lastOperation, "random");
    }
    function test_hover_delete_and_keyboard_access() {
        const view = createView();
        const moon = control(view, "theme-Moonlight");
        const removeMoon = control(view, "delete-theme-Moonlight");
        verify(removeMoon.contentItem.width > 0 && removeMoon.contentItem.height > 0);
        mouseMove(view, 1, 1);
        compare(removeMoon.opacity, 0);
        mouseMove(moon, moon.width / 2, moon.height / 2);
        tryCompare(removeMoon, "opacity", 1);
        compare(moon.selected, false);
        compare(themeService.entries.find(entry => entry.current).name, "custom");
        mouseMove(view, 1, 1);
        tryCompare(removeMoon, "opacity", 0);
        moon.forceActiveFocus(Qt.TabFocusReason);
        tryCompare(removeMoon, "opacity", 1);
        keyClick(Qt.Key_Tab);
        tryCompare(removeMoon, "activeFocus", true);
        keyClick(Qt.Key_Return);
        compare(findChild(view, "theme-Moonlight"), null);
        compare(themeService.entries.find(entry => entry.current).name, "custom");
        const active = control(view, "theme-custom");
        mouseMove(active, active.width / 2, active.height / 2);
        verify(!control(view, "delete-theme-custom").visible);
        verify(!control(view, "delete-background-Dunes").visible);
        const forest = control(view, "background-Forest");
        view.revealItem(forest);
        verify(waitForPolish(view));
        const removeForest = control(view, "delete-background-Forest");
        mouseMove(view, 1, 1);
        compare(removeForest.opacity, 0);
        mouseMove(forest, forest.width / 2, forest.height / 2);
        tryCompare(removeForest, "opacity", 1);
        compare(forest.applied, false);
        compare(removeForest.background.color, "#00000000");
        compare(removeForest.contentItem.ink, "#cc2222");
        verify(removeForest.contentItem.width > 0 && removeForest.contentItem.height > 0);
        const iconPosition = removeForest.mapToItem(view, 0, 0);
        tryVerify(() => {
            const sceneImage = grabImage(view);
            for (let y = Math.ceil(iconPosition.y); y < iconPosition.y + removeForest.height; y++) {
                for (let x = Math.ceil(iconPosition.x); x < iconPosition.x + removeForest.width; x++) {
                    if (sceneImage.red(x, y) > sceneImage.green(x, y) * 2) return true;
                }
            }
            return false;
        }, 1000, "Floating delete icon must render above the wallpaper");
        click(removeForest);
        compare(findChild(view, "background-Forest"), null);
        compare(backgroundService.entries.length, 5);
        compare(backgroundService.lastOperation, "remove");
    }
    function test_repository_dialog() {
        const view = createView();
        view.forceActiveFocus();
        const importer = control(view, "importThemeUrl");
        importer.forceActiveFocus();
        keyClick(Qt.Key_Return);
        const dialog = control(view, "themeImportDialog");
        tryCompare(dialog, "opened", true);
        const field = control(dialog, "themeSourceInput");
        verify(field.activeFocus);
        field.text = "invalid";
        keyClick(Qt.Key_Return);
        verify(dialog.errorMessage.length > 0);
        compare(dialog.visible, true);
        field.text = "https://github.com/example/sample";
        keyClick(Qt.Key_Return);
        compare(dialog.visible, true);
        compare(themeService.lastOperation, "preview");
        verify(findChild(view, "theme-sample") === null);
        const preview = control(dialog, "themeDownloadPreview");
        verify(preview.text.includes("wallpapers/night.jpg"));
        verify(preview.text.includes("ttf-outfit · aur · will install"));
        const name = control(dialog, "themeNameInput");
        verify(name.activeFocus);
        compare(name.text, "sample");
        name.text = "my-theme";
        keyClick(Qt.Key_Return);
        tryCompare(dialog, "visible", false);
        verify(findChild(view, "theme-my-theme") !== null);
        compare(themeService.installedName, "my-theme");
        importer.forceActiveFocus();
        keyClick(Qt.Key_Return);
        tryCompare(dialog, "opened", true);
        keyClick(Qt.Key_Escape);
        tryCompare(dialog, "visible", false);
        compare(view.mockState.page, "appearance");
        verify(view.visible);
    }
    function test_theme_selection_and_shuffle_apply_immediately() {
        themeService.entries = themeService.entries.concat([themeService.card("Fourth", "dark", "#55aaff", false)]);
        const view = createView();
        const moon = control(view, "theme-Moonlight");
        moon.forceActiveFocus();
        keyClick(Qt.Key_Return);
        compare(themeService.lastOperation, "select");
        compare(control(view, "theme-Moonlight").applied, true);
        verify(control(view, "applied-theme-Moonlight").visible);
        verify(!control(view, "delete-theme-Moonlight").visible);
        compare(backgroundService.lastOperation, "list");
        const random = control(view, "randomTheme");
        random.forceActiveFocus();
        keyClick(Qt.Key_Return);
        compare(themeService.lastOperation, "random");
        compare(control(view, "theme-Moonlight").applied, false);
    }
    function test_import_tiles_fill_their_bounds_and_shuffle_needs_four_items() {
        const view = createView();
        compare(control(view, "themeTitle").text, "Theme");
        for (const kind of ["Theme", "Background"]) {
            const tile = control(view, kind.toLowerCase() + "ImportTile");
            for (const action of ["File", "Url"]) {
                const button = control(tile, "import" + kind + action);
                const point = button.mapToItem(tile, 0, 0);
                compare(point.x, 0);
                compare(point.y, 0);
                compare(button.width, tile.width);
                compare(button.height, tile.height);
            }
        }
        compare(control(view, "randomTheme").visible, false);
        themeService.entries = themeService.entries.concat([themeService.card("Fourth", "dark", "#55aaff", false)]);
        compare(control(view, "randomTheme").visible, true);
        themeService.entries = themeService.entries.slice(0, 3);
        compare(control(view, "randomTheme").visible, false);
        compare(control(view, "randomBackground").visible, true);
        backgroundService.entries = backgroundService.entries.slice(0, 3);
        compare(control(view, "randomBackground").visible, false);
        backgroundService.entries = backgroundService.entries.concat([{name: "Fourth", current: false, source: "", video: true}]);
        compare(control(view, "randomBackground").visible, true);
    }
    function test_navigation_search_and_max_width() {
        const view = createView();
        compare(findChild(view, "nav-desktop"), null);
        view.width = 1600;
        verify(waitForPolish(view));
        const content = control(view, "settingsContent");
        verify(content.width <= 760);
        const point = content.mapToItem(view, 0, 0);
        verify(Math.abs(point.x + content.width / 2 - (191 + (view.width - 191) / 2)) < 2);
        view.focusSetting("lock");
        verify(waitForPolish(view));
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
        compare(findChild(view, "changeBar"), null);
        compare(control(view, "pageTitle").visible, false);
        compare(view.mockState.groups.length, 0);
        verify(!control(view, "themeImportTile").visible);
    }
    function test_import_tile_and_download_dialog() {
        const view = createView();
        const tile = control(view, "backgroundImportTile");
        view.revealItem(tile);
        verify(waitForPolish(view));
        const local = control(view, "importBackgroundFile");
        const remote = control(view, "importBackgroundUrl");
        compare(local.contentItem.children[0].ink, remote.contentItem.children[0].ink);
        verify(local.contains(Qt.point(local.width * 0.2, local.height * 0.2)));
        verify(!local.contains(Qt.point(local.width * 0.8, local.height * 0.8)));
        verify(remote.contains(Qt.point(remote.width * 0.8, remote.height * 0.8)));
        verify(!remote.contains(Qt.point(remote.width * 0.2, remote.height * 0.2)));
        for (const button of [local, remote]) {
            verify(!button.contains(Qt.point(-10, -10)));
            verify(!button.contains(Qt.point(button.width + 10, button.height + 10)));
            verify(!button.contains(Qt.point(button.width / 2, -button.height)));
        }
        mouseClick(remote, remote.width * 0.75, remote.height * 0.75);
        const dialog = control(view, "backgroundDownloadDialog");
        tryCompare(dialog, "opened", true);
        const field = control(dialog, "dialogInput");
        verify(field.activeFocus);
        field.text = "invalid";
        keyClick(Qt.Key_Return);
        verify(dialog.errorMessage !== "");
        verify(dialog.visible);
        field.text = "https://example.com/background.jpg";
        keyClick(Qt.Key_Return);
        tryCompare(dialog, "visible", false);
        verify(findChild(view, "background-Installed") !== null);
        remote.forceActiveFocus(Qt.TabFocusReason);
        keyClick(Qt.Key_Return);
        tryCompare(dialog, "opened", true);
        keyClick(Qt.Key_Escape);
        tryCompare(dialog, "visible", false);
        backgroundService.entries = [];
        verify(!control(view, "randomBackground").enabled);
        view.focusSetting("background");
        verify(local.activeFocus);
    }
    function test_layout_sizes_and_capture() {
        const view = createView();
        for (const size of [[740,560], [1000,850], [1600,1000]]) {
            view.width = size[0];
            view.height = size[1];
            verify(waitForPolish(view));
            const content = control(view, "settingsContent");
            verify(content.width > 0 && content.width <= 760);
            const card = control(view, "theme-Daylight");
            const p = card.mapToItem(content, 0, 0);
            verify(p.x >= 0 && p.x + card.width <= content.width + 1);
        }
        view.width = 1100;
        view.height = 950;
        verify(waitForPolish(view));
        grabImage(view).save("/tmp/luna-settings-appearance.png");
    }
}
