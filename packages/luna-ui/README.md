# Luna UI

Shared QML typography and buttons for Quickshell apps. Add `packages/luna-ui/src`
to your app's `QML_IMPORT_PATH`, then pass its resolved Luna theme:

```qml
import QtQuick
import Luna.UI 1.0 as UI

Item {
    id: root
    required property var themeSnapshot

    UI.Theme { id: uiTheme; snapshot: root.themeSnapshot }
    UI.Button {
        theme: uiTheme
        text: "Save"
        variant: UI.Button.Secondary
    }
}
```

See [DOCS.md](DOCS.md) for components and checks.
