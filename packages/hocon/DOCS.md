# HOCON API

Use `luna_next_hocon::Config`; see [README.md](README.md) for an example.
All methods return `Result`. `Value` means `serde_json::Value`.

| Method | Result | Behavior |
| --- | --- | --- |
| `Config::open(file)` | `Config` | Load and resolve HOCON; create missing files and parent directories. |
| `get(path)` | `&Value` | Read a resolved value; missing keys return null. |
| `set(path, value)` | `()` | Save a setting and update loaded values. |
| `unset(path)` | `()` | Remove its definitions from the opened file; inherited values become visible. Missing settings are a no-op. |
| `resolved()` | `&Value` | Borrow the full effective configuration. |
| `to_json()` | `String` | Return pretty JSON text without saving it. |

Paths use nonempty dot-separated object keys, such as `wallpaper.duration`.
Array indexing and quoted path expressions are unsupported. Missing keys,
reads through non-objects, and explicit null return `Value::Null`.
Values accept all JSON types; objects follow HOCON merge rules.

## Files and includes

- Reads use loaded values. Reopen to read external changes.
- Edits change only the opened file, preserving includes, comments, and unrelated
  source text. Included files stay separate; resolved data is never written back.
- Relative includes resolve from each including file. HOCON and JSON are supported;
  extension probing gives `.conf` precedence over `.json`.
- Missing includes are optional. Use `include required(file("defaults.conf"))`
  when the file must exist.
- Existing symlinks are followed. If the opened file is later deleted, `set`
  recreates it with only the new setting; `unset` leaves it absent.

## Limits and errors

- Uses `hocon-rs 0.2.0`. Remote URLs, Java properties, and classpath lookup are
  unsupported. HOCON nesting and include chains are limited to 64 levels.
- Cycles, unresolved required substitutions, invalid syntax, and I/O failures
  return errors. Missing keys do not.
- Unsafe edits through substitutions or removing/replacing objects with includes
  return `Error::Edit`. Empty object blocks and blank lines may remain after edits.
- Saves are validated, synced, and atomic, preserving permissions. A directory-sync
  error after replacement reports that saving already happened.
- Changed file contents return `Error::Conflict`; reopen before editing. Serialize
  concurrent writers: conflict checks are optimistic, without cross-process locking.

## Tests

From the repository root:

```sh
cargo test -p luna-next-hocon
```
