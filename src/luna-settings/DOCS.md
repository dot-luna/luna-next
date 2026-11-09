# Settings

Run `bun src/luna-settings/src/index.ts` from the repository root. No installation
or build is needed when Quickshell and Qt Quick Controls are available.

The launcher reads the current theme once through `Luna.theme.get()` and passes
its colors, UI font, and rounding to the window. Reopen Settings to use a changed theme.

- Hardware includes power mode, charge limit, keyboard timeout, fan controls, and battery health.
- Ctrl+F or Ctrl+K focuses search. Enter opens the selected result; Down enters
  the results, then Up/Down selects. Tab/Shift+Tab moves between controls.
- Alt+Left or the back button returns from a detail page. Escape clears search
  first, or returns to Hardware. Ctrl+W exits.
- Radio buttons, switches, choices, and sliders also support the mouse and
  their normal Qt keyboard controls.

`HardwareModel.qml` is an in-memory mock API. All changes last only for the
window's session; controls do not call the hardware API or change the system.
It is the single replacement point for connecting live hardware later.

Static check:

```sh
/usr/lib/qt6/bin/qmllint src/luna-settings/src/shell/*.qml
```

Free Hugeicons are bundled with their [MIT notice](src/shell/icons/LICENSE.md).
