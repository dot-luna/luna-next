# Controls

Home is blank. Appearance contains Style, Background, Text, and More.
Login screen and Lock screen are under More. Content stays centered at a maximum width of 760 px.

Background shows installed wallpapers. The first tile opens the file picker or a URL
download dialog, using the system desktop portal for file selection. Imports are copied into the library. Click a wallpaper to apply it;
The shuffle button beside Background selects another installed wallpaper. Changes are saved immediately.
Hover or keyboard focus reveals a red delete action. Applied wallpapers cannot be deleted.
Errors appear beside the gallery or in the download dialog.

Theme, text, login, and lock controls still use sample data. Theme repository URLs
are not fetched. These mock changes reset when the window closes.

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
