# QML adapter

## API and behavior

`import LunaNext.Config` exposes the singleton `Config` with one function:

```qml
var config = Config.load_as_json(path)
```

The return value is a plain JavaScript object, not JSON text. It contains the
final HOCON configuration after includes, substitutions, and object merging.
Objects and arrays are ordinary mutable JavaScript values; changes affect only
the returned object, never the source files. Missing properties are `undefined`,
explicit null remains `null`, and normal JavaScript number precision applies
(use strings for integer IDs above `2^53 - 1`).

Call once during startup and retain the object. There are no editing methods,
live getters, file watchers, automatic updates, or persistent caches. Each
explicit call loads a fresh object.

Pass an absolute file path, a path relative to the process's working directory,
or a local file URL such as `Qt.resolvedUrl("config.conf")`. Quickshell's
`Quickshell.shellPath("config.conf")` resolves from the shell's configuration
root. Other URL schemes are rejected.

The adapter uses the [Rust helper](../hocon/DOCS.md). A missing entry point and
parent directories are created automatically and yield `{}`. Existing files are
preserved. Relative includes resolve from their including file. Malformed HOCON,
failed required includes, and filesystem failures become catchable JavaScript
`Error` values; use `try`/`catch` around the startup call if the shell needs to
display or handle a loading failure.

## Build and installation

Requirements: Rust/Cargo, C++17 compiler, CMake 3.21+, Qt 6.5+ Core/Qml and their
development tools; Ninja for the commands in the README. The QML runtime
(`qml6` or `qml`) is needed when building with tests enabled. Use
`-DBUILD_TESTING=OFF` to build only the plugin.

The README shows the development build and import setup. The output module is
`target/hocon-qml/qml/LunaNext/Config`, containing the shared plugin, `qmldir`,
and `plugins.qmltypes`. Cargo builds the Rust static bridge through CMake; Qt
registers the singleton and converts its JSON result to a JavaScript object.
The bridge uses compact JSON to avoid formatting work and extra transfer bytes.
The core `luna-next-hocon` crate remains Qt-independent.

Install locally after building:

```sh
cmake --install target/hocon-qml --prefix "$HOME/.local"
QML_IMPORT_PATH="$HOME/.local/lib/qt6/qml" quickshell -p /path/to/shell.qml
```

The install location is
`<prefix>/<CMAKE_INSTALL_LIBDIR>/qt6/qml/LunaNext/Config`; the example assumes
`CMAKE_INSTALL_LIBDIR=lib`. Add the containing `qt6/qml` directory to the QML
import path if Qt does not search it. Override the relative module directory
with CMake's `LUNA_NEXT_QML_INSTALL_DIR` cache variable when packaging.

## Checks and layout

From the repository root, after building the plugin:

```sh
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check
ctest --test-dir target/hocon-qml --output-on-failure
```

`src/` contains the Rust bridge and Qt singleton. `tests/bridge.rs` tests Rust
resolution, creation, and failures; `tests/smoke.qml` tests the import, JavaScript
types and object independence, minimal API, and catchable errors. Fixtures are in
`tests/data/`. The QML smoke test runs headlessly without a Quickshell session.
