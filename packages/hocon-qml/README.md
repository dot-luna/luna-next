# LunaNext.Config

Load HOCON once into a plain JavaScript object for Quickshell or QML.

```qml
import Quickshell
import LunaNext.Config

ShellRoot {
    property var config: ({})

    Component.onCompleted: {
        config = Config.load_as_json(Quickshell.shellPath("config.conf"))
    }
}
```

Build and install the module from the repository root:

```sh
mise run install:hocon-qml
export QML_IMPORT_PATH="$HOME/.local/lib/qt6/qml${QML_IMPORT_PATH:+:$QML_IMPORT_PATH}"
quickshell -p /path/to/shell.qml
```

Use `config` directly in memory. See [DOCS.md](DOCS.md) for setup, behavior, and tests.
