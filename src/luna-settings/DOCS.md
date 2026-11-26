# Controls

Home is blank. Appearance contains Style, Background, Text, and More.
Login screen and Lock screen are under More. Content stays centered at a maximum width of 760 px.

Theme cards show their main palette and a sun or moon for their mode. Hover over an
inactive theme or background to show its delete action; keyboard focus reveals it too.
Applied items cannot be deleted. Add Theme opens a repository URL dialog.
Background cards mark the applied choice. Add Picture previews a local image in the gallery.

Ctrl+K focuses search. Tab moves between controls; Enter or Space activates buttons.
Arrows navigate the galleries. Escape dismisses a dialog, clears search, returns from
an inner page, or closes the window. Alt+Left returns to Appearance.

Gallery entries and add/delete actions are mock data. Repository URLs are not fetched.
Apply and Discard affect this window only. Closing the window resets the mock.

The launcher resolves the current Luna theme once for colors, fonts, rounding,
borders, opacity, and background blur. Reopen Settings after changing the theme.
Invalid themes prevent startup and report the shared API's validation error.

## Checks

From the repository root:

```sh
bun run --cwd src/luna-settings check
/usr/lib/qt6/bin/qmllint src/luna-settings/src/shell/*.qml src/luna-settings/tests/tst_theme.qml
bun test src/luna-settings/tests
```
