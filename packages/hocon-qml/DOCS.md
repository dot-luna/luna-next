# LunaNext.Config

`import LunaNext.Config` exposes `Config.load_as_json(path)`, which returns the
resolved HOCON configuration as a plain JavaScript object. Load it at startup
and keep the object in memory.

- Accepts local paths and file URLs; relative paths use the working directory.
  Includes resolve relative to their source file.
- Missing files and parent directories are created; an empty file returns `{}`.
- Changing the returned object affects memory only. Missing properties are
  `undefined`; explicit null stays `null`. JavaScript number precision applies.
- Parsing, required-include, and filesystem failures throw catchable `Error` values.

## Build and install

Needs Qt 6.5+ Core/QML development tools, C++17, CMake 3.21+, Rust/Cargo, and
Ninja for the [README commands](README.md). Use Qt matching the host application.
QML smoke tests need `qml6` or `qml`; use `-DBUILD_TESTING=OFF` to skip them.

After building:

```sh
cmake --install target/hocon-qml --prefix "$HOME/.local"
```

Add `<prefix>/<CMAKE_INSTALL_LIBDIR>/qt6/qml` to `QML_IMPORT_PATH`.

## Tests

From the repository root, after building:

```sh
cargo test -p luna-next-hocon-qml
ctest --test-dir target/hocon-qml --output-on-failure
```
