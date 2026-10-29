---
name: clean-code
description: Write or review Rust, QML, and bridge code in Luna Next with focused modules, clear ownership, meaningful comments, and relevant tests. Use for implementation, module design, or code-quality reviews.
---

# Clean Code

Follow [AGENTS.md](../../../AGENTS.md) and the user's requested scope. Apply this
skill to design and implementation; use `code-simplifier` for a behavior-preserving
cleanup when that is the task.

## Place the change

- Read the affected package's public API, nearby code, and tests first.
- Keep configuration helpers, the one-shot QML adapter, shared app operations,
  CLI presentation, and rendering in their existing owners, as defined in
  `AGENTS.md`. Reuse those boundaries instead of adding parallel implementations.
- Put implementation in `src/` and tests and fixtures in `tests/`.
- Split mixed responsibilities into named Rust modules or QML components. Keep
  entry points small and related behavior together; use responsibility and
  navigation, rather than a line-count target, to decide when to split a file.

## Write the code

- Prefer direct control flow, domain names, and existing standard-library or
  repository helpers. Extract a helper when it isolates a useful concept.
- Use Rust ownership, structs, enums, and `Result` where they clarify the
  contract. Add traits or abstraction layers only for a concrete need.
- Keep QML bindings and component lifecycle idiomatic. Make process ownership,
  startup, failure, and cleanup clear when changing renderer code.
- Keep I/O and mutations visible. Preserve diagnostics, validation, and conflict
  handling instead of hiding errors behind empty values or generic fallbacks.
- Explain non-obvious intent, invariants, and caller contracts in comments or
  API docs. Improve unclear names before adding comments that narrate the code.
- Change only what the task needs. Remove code made obsolete by the change;
  leave unrelated cleanup for a separate request.

## Verify

Use [reference.md](reference.md) to choose checks for the affected layer and its
important contracts. Prefer a regression test for a bug or behavior change;
structural refactors can use existing coverage. Keep fixtures isolated from the
user's configuration and desktop. Report what ran and any remaining limitation.

Adapted for this repository from [markoa/clean-code-skill](https://github.com/markoa/clean-code-skill).
