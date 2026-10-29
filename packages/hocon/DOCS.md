# HOCON configuration API

## API

Import `luna_next_hocon::Config`. Workspace members can depend on
`luna-next-hocon = { workspace = true }`. `Value` below is `serde_json::Value`;
all methods return the crate's `Result`.

| Method | Result | Behavior |
| --- | --- | --- |
| `Config::open(path)` | `Config` | Load a HOCON file; create an empty file and missing parent directories if needed. |
| `get(path)` | `&Value` | Read a resolved value; return null when absent or reached through a non-object. |
| `set(path, value)` | `()` | Add or update a setting and save immediately. |
| `unset(path)` | `()` | Remove its definitions from the opened file; absent settings are a no-op. |
| `resolved()` | `&Value` | Borrow the full resolved configuration. |
| `to_json()` | `String` | Return resolved pretty JSON text in memory. |

Paths use nonempty dot-separated object keys, such as `wallpaper.duration`.
Array indexing and quoted path expressions are unsupported. Reads of missing
keys and explicit null both return `Value::Null`, without changing the file.
Values can be strings, numbers, booleans, arrays, objects, or null. Objects merge
using HOCON semantics. Setting a child beneath a scalar or array creates an
object at that path.

Reads use loaded values; successful edits update them. Open another `Config` to
read external changes. There is no environment-based file selection or reload API.

## Includes and source editing

`defaults.conf`:

```hocon
wallpaper { path = "default.jpg", transition = "fade", duration = 300 }
```

`config.conf`:

```hocon
include file("defaults.conf")
wallpaper.duration = 500
```

Opening `config.conf` resolves duration to `500` and retains the included path
and transition. Removing `wallpaper.duration` exposes `300`. Edits touch only
the opened entry point; included files and include directives are preserved.
Resolved data is never saved as a merged configuration file.

Relative includes resolve from each including file's directory. Ordinary missing
includes are optional; use `include required(file("defaults.conf"))` to require
one. Local HOCON and JSON includes are supported, including extension probing;
`.conf` takes precedence over `.json` when both exist. Only missing optional
includes are ignored; permission errors and other I/O failures are reported.
Remote URLs and Java properties are unsupported; no Java classpath is configured.
Include chains and document nesting have a 64-level limit; cycles are errors.
Existing entry-point symlinks are followed.

The parser/resolver is [hocon-rs 0.2.0](https://github.com/mikai233/hocon-rs).
A small file loader uses its syntax tree and resolver, with source validation
to catch truncated input and avoid upstream EOF lookahead losing short keys.
Multiline strings retain extra quotes in their closing run; affected tokens are
normalized only in memory to work around the backend parser's handling.
Required substitutions must resolve. Complex syntax remains subject to the
upstream parser's support.

Edits preserve unrelated source bytes, comments, and formatting. Setting a value
removes its previous definitions and appends a final escaped assignment.
Unsetting removes every matching definition, including duplicates. Blank lines
and empty object blocks can remain. Editing through substitution ancestors or
removing an object that contains includes is rejected when preservation cannot
be guaranteed; these configurations remain readable.

## Writes and errors

Edits are validated before saving through a temporary file in the same directory.
The file is synced and atomically replaced, preserving existing permissions; on
Unix, the containing directory is synced too. A directory-sync failure happens
after saving and is identified in the error; loaded values already reflect it.
Failures before replacement leave the original file and loaded values intact.

Changed entry-point contents cause `Error::Conflict`; reopen before editing.
This is optimistic detection, not a cross-process lock. Callers must serialize
simultaneous writers. Includes are reread for edit validation without a
transaction across files.

If the entry point was deleted, `set` creates a fresh file containing only the
requested setting, without restoring old settings or includes. Creation never
overwrites a file that appeared concurrently. `unset` leaves a deleted file absent.

Errors cover failed I/O (`Io`), parsing/includes/resolution (`Parse`), malformed
paths (`InvalidPath`), concurrent changes (`Conflict`), unsafe source edits
(`Edit`), and JSON encoding (`Json`). Ordinary absence uses creation, null, or a
no-op as described above; real failures are not silently replaced by empty data.

## Checks

From the repository root:

```sh
cargo test -p luna-next-hocon
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check
```

Integration tests are in `tests/config.rs`; editor unit tests are in
`tests/unit/edit.rs`. Implementation stays in `src/`. The Rust package does not
depend on Qt; the [QML adapter](../hocon-qml/DOCS.md) is separate.
