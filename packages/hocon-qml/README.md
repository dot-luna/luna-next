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

Build and expose the module from the repository root:

```sh
cmake -S packages/hocon-qml -B target/hocon-qml -G Ninja
cmake --build target/hocon-qml
QML_IMPORT_PATH="$PWD/target/hocon-qml/qml" quickshell -p /path/to/shell.qml
```

Use `config` directly in memory. See [DOCS.md](DOCS.md) for setup, behavior, and tests.
