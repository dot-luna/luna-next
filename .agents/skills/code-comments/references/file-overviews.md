# Module and component overviews

Add an overview when the reader needs context about a module's responsibility or
interacting rules. Avoid mandatory headers on every file, filename inventories,
and paragraphs that merely restate imports or declarations.

## Rust

Use `//!` near the start of a module, before imports and items, following any
required file header. Document caller-facing behavior on the relevant `///`
item rather than repeating it in the overview.

For source-preserving editing code, after verifying the behavior:

```rust
//! Edit the opened HOCON source while retaining includes and unrelated text.
//! Resolved values support reads and validation; they are never serialized over
//! the original source as a shortcut for applying edits.
```

For a module coordinating save and renderer application, explain the phases and
which component owns rollback. State external-edit protection and recovery
limits only as established by the actual implementation. A simple delegating
module usually needs less context than the implementation of that coordination.

## QML

Place an ordinary comment after required pragmas and imports, near the component
it describes. For the video component's existing ownership model:

```qml
// One owned player per Loader instance. Recreate the component to change media.
```

Keep the reason for disconnect-before-stop beside the shutdown operation.
Do not repeat all property defaults or describe the whole application here.

## C++ and JavaScript

Follow existing file-header and module conventions. Explain a bridge's conversion
or lifetime boundary when the interface alone does not express it. Keep function
contracts beside functions and local exceptions beside the affected operations.

After formatting or moving declarations, check that comments still attach to the
intended module, item, or operation. No Go-specific package files or formatter
commands are required in this repository.
