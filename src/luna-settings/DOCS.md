# Controls

Home, Hyprland, Apps, and About are blank. Appearance contains Theme, Background, and More.
Login screen and Lock screen are under More. Content stays centered at a maximum width of 760 px.
Scrollbars sit at the far right edge of the page area.

Background shows installed wallpapers. The first tile opens the file picker or a URL
download dialog, using the system desktop portal for file selection. Imports are copied into the library. Click a wallpaper to apply it.
With more than three wallpapers, shuffle selects another installed wallpaper. Changes are saved immediately.
Hover or keyboard focus reveals a red delete action. Applied wallpapers cannot be deleted.
Errors appear beside the gallery or in the download dialog.

Theme shows installed themes. Use the first tile to choose a JSON/JSONC file or
folder, or enter a raw file/GitHub folder URL. The import dialog shows fonts,
wallpapers, files and package requirements before installation, with an editable
name. Missing packages use desktop authentication when needed. Click a theme to
select it. Shuffle appears when more than three themes are installed. Hover or
keyboard focus reveals delete for themes that are not applied. No Apply/Discard step is needed.

Login and lock controls still use sample data and reset when the window closes.

Ctrl+K focuses search. Tab moves between controls; Enter or Space activates buttons.
Arrows navigate the galleries. Escape dismisses a dialog, clears search, returns from
an inner page, or closes the window. Alt+Left returns to Appearance.

The window uses the active Luna theme. Reopen Settings after changing the theme.

## Checks

From the repository root:

```sh
bun run --cwd src/luna-settings check
/usr/lib/qt6/bin/qmllint -I packages/luna-ui/src src/luna-settings/src/shell/*.qml src/luna-settings/tests/tst_theme.qml
bun test src/luna-settings/tests
```
