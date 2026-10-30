pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io

ShellRoot {
    id: shell

    readonly property bool validating: Quickshell.env("LUNA_NEXT_MENU_VALIDATE") === "1"
    readonly property MenuWindow menuWindow: menu.item
    property var theme: null
    property var menuScreen: Quickshell.screens[0] || null

    function loadTheme() {
        const value = JSON.parse(Quickshell.env("LUNA_NEXT_MENU_THEME"));
        if (!value || typeof value !== "object" || !value.colors || !value.fonts || !value.appearance)
            throw new Error("expected colors, fonts, and appearance objects");
        for (const role of ["background", "foreground", "bright_foreground", "muted", "accent",
                           "selection", "selection_foreground", "lighter_background"]) {
            if (typeof value.colors[role] !== "string" || value.colors[role] === "")
                throw new Error("missing theme color: " + role);
        }
        if (typeof value.fonts.ui !== "string" || value.fonts.ui === "")
            throw new Error("missing theme UI font");
        for (const role of ["rounding", "border_width"]) {
            if (typeof value.appearance[role] !== "number" || !Number.isFinite(value.appearance[role]) || value.appearance[role] < 0)
                throw new Error("invalid theme appearance: " + role);
        }
        return value;
    }

    function show() {
        if (!menuWindow)
            return;
        const focused = Hyprland.focusedMonitor;
        menuScreen = Quickshell.screens.find(screen => focused && screen.name === focused.name) || Quickshell.screens[0] || null;
        menuWindow.show();
    }

    Loader {
        id: menu
        active: shell.theme !== null
        sourceComponent: MenuWindow {
            theme: shell.theme
            screen: Quickshell.screens.includes(shell.menuScreen) ? shell.menuScreen : Quickshell.screens[0] || null
        }
        onLoaded: if (shell.validating) {
            // Instantiate the real UI and native imports without taking keyboard focus.
            Qt.callLater(() => {
                console.info("Luna Next menu validation passed");
                Qt.quit();
            });
        }
    }

    IpcHandler {
        target: "menu"
        function status(): string { return shell.menuWindow ? "running" : "unavailable"; }
        function show(): void { shell.show(); }
        function hide(): void { if (shell.menuWindow) shell.menuWindow.hide(); }
        function toggle(): void {
            if (shell.menuWindow && shell.menuWindow.opened)
                shell.menuWindow.hide();
            else
                shell.show();
        }
    }

    Component.onCompleted: {
        Quickshell.watchFiles = false;
        try {
            theme = loadTheme();
        } catch (error) {
            console.error("Luna Next menu theme: " + error.message + ". Start the menu with lnxt menu serve.");
            Qt.callLater(() => Qt.exit(1));
        }
    }
}
