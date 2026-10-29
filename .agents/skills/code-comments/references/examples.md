# Comment examples

Use these patterns after verifying the relevant implementation and callers.
They illustrate comment wording only; add explanations where needed, without
changing executable code to match an example.

## Rust caller contracts

The HOCON helper's `get` validates dot-separated paths, borrows the resolved
value, and uses JSON null for absent values. A useful item comment distinguishes
those cases without repeating each expression:

```rust
/// Borrow the effective value at a dot-separated object path.
/// Missing keys and explicit JSON null both return `Value::Null`.
/// Empty path segments return `Error::InvalidPath`.
```

Verify error variants against the current source before using the example.
Do not add boilerplate parameter or return sections that merely restate types.

For a mutation API, inspect validation, saving, and renderer application together
before documenting success or failure. State an external-edit exception near a
rollback guarantee rather than promising unconditional restoration.

## Persistence and concurrency

For a helper that compares the current file with the source it wrote before
restoring earlier bytes, the reason for the comparison matters:

```rust
// Refuse restoration after an external edit so rollback preserves the writer's changes.
```

This describes an optimistic check. It does not promise cross-process locking
or eliminate a race between comparison and replacement. Name the lock and its
lifetime only after checking which callers hold it.

When a lock file remains on disk after releasing its lock, explain why if the
implementation relies on persistent path identity:

```rust
// Keep the lock path so later callers lock the same file as existing holders.
```

## QML lifecycle

In `VideoWallpaper.qml`, shutdown disconnects IPC before stopping its owned
player. The ordering reason adds information beyond the assignments:

```qml
// Disconnect before stopping the child so expected shutdown is not an error.
```

A property such as `startupTimeout` may need units and the event it bounds.
Verify its timer use before documenting it. Avoid narrating routine bindings,
property assignments, or every lifecycle callback.

## C++ and JavaScript conversion

The config bridge uses `JSON.parse` to return ordinary JavaScript objects and
arrays. Explain the representation choice beside conversion:

```cpp
// JSON.parse returns ordinary JavaScript objects and arrays; QVariant
// conversion would expose Qt sequence wrappers instead.
```

Check lifetime assumptions at the bridge boundary. A local byte buffer passed as
`rust::Str` does not establish that the Rust side may retain it after the call.

## Tests and review failures

Let descriptive test names and assertions carry ordinary expectations. Comment
unusual isolation or fixtures, such as a subprocess preventing environment
changes from affecting parallel Cargo tests.

| Problem | Correction |
| --- | --- |
| A comment translates a guard or assignment | State the invariant or remove the redundant narration |
| A comment promises every failure restores the source | Check conflicts and partial failures; document the actual conditions |
| Types, overviews, and operations repeat one rule | Keep the contract at its owner and explain local mechanisms where needed |
| Every private getter gets a paragraph | Keep obvious code uncommented; cover meaningful private constraints |
| An example adds plausible but unverified motives | Inspect evidence or report the unknown |
| A comment explains what changed in this task | State the current behavior; leave change history in the commit |
