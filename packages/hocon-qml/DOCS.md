# LunaNext.Config

`import LunaNext.Config` exposes `Config.load_as_json(path[, schemaPath])`.
Load the resolved HOCON once and keep the returned JavaScript object in memory.

- Accepts local paths and file URLs; relative paths use the working directory.
  Includes resolve relative to their source file.
- Missing configuration files and parent directories are created. Empty files
  load `{}`; supplied schemas still apply. Schema files must already exist.
- Changing the returned object affects memory only. Missing properties are
  `undefined`; explicit null stays `null`. JavaScript number precision applies.
- Parsing, required-include, filesystem, and validation failures throw catchable
  `Error` values. Validation errors include the failing field's JSON Pointer.

## Validation

Each app owns its JSON Schema; pass its path when loading:

```qml
config = Config.load_as_json(configPath, Quickshell.shellPath("config.schema.json"))
```

Both arguments accept local paths or file URLs. Omit `schemaPath` or pass `""`
to skip validation. Validation checks resolved values without changing files,
inserting defaults, or converting types. The schema controls required fields
and whether unknown properties are accepted. Internal `$defs`/`$ref` references
work; external schema references are rejected without network or file retrieval.

## Build and install

Needs Qt 6.5+ Core/QML development tools, C++17, CMake 3.21+, Rust/Cargo,
Ninja, and mise for the [README commands](README.md). Use Qt matching the host
application.
QML smoke tests need `qml6` or `qml`; use `-DBUILD_TESTING=OFF` to skip them.

From the repository root:

```sh
mise run build:hocon-qml    # Build only
mise run install:hocon-qml  # Build and install into ~/.local
```

The module installs to `~/.local/lib/qt6/qml/LunaNext/Config/`. Set this in your
desktop session so QML apps can import it:

```sh
export QML_IMPORT_PATH="$HOME/.local/lib/qt6/qml${QML_IMPORT_PATH:+:$QML_IMPORT_PATH}"
```

For Hyprland with [UWSM](https://github.com/Vladimir-csp/uwsm#4-environments-and-shell-profile),
create `~/.config/uwsm/env` (and its parent directory if needed) and add that line.
Log out and back in so desktop and autostart apps inherit it. If you customize
`XDG_CONFIG_HOME`, use `$XDG_CONFIG_HOME/uwsm/env` instead.

For terminal-launched apps only, put the line in `~/.zshrc` or `~/.bashrc` and
reload the shell.

## Tests

From the repository root, after building:

```sh
cargo test -p luna-next-hocon-qml
ctest --test-dir target/hocon-qml --output-on-failure
```
