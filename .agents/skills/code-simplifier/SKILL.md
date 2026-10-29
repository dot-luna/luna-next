---
name: code-simplifier
description: Simplify Luna Next code without changing behavior. Use for cleanup, readability improvements, splitting mixed responsibilities into modules, or a final refactoring pass on requested files.
---

# Code Simplifier

Follow [AGENTS.md](../../../AGENTS.md). Preserve public APIs, results, errors,
side effects, and lifecycle behavior while making the requested code clearer.

## Scope

- Inspect the requested files and current diff. Separate existing user changes
  from the refactor; a dirty file is not permission to rewrite all of it.
- For review-only requests, report findings without editing. For cleanup requests,
  implement focused changes and verify them.
- Keep unrelated files, formatting, and pre-existing dead code out of the change.

## Simplify

- Replace deep nesting and dense expressions with clear, idiomatic Rust or QML.
- Split functions into named stages when each stage represents a useful concept.
  Split files or QML components when they mix responsibilities; keep public entry
  points small and implementation details private where practical.
- Keep related code together. Avoid arbitrary line limits, catch-all utility
  modules, wrapper types, and traits added solely to shorten a function or file.
- Reuse existing parsing, schema validation, path handling, and application
  operations. Do not duplicate them in CLI or QML code.
- Keep deterministic transforms separate from I/O when this clarifies data flow;
  use ordinary loops or mutation when they are easier to follow.
- Preserve comments explaining source preservation, concurrency, process
  ownership, or other non-obvious constraints. Remove comments that merely repeat
  the code, and update any explanation affected by moved logic.

## Verify behavior

Treat configuration source preservation, offline schema resolution, automatic
renderer application, and conflict-safe rollback as behavior, not incidental
implementation details. Preserve the one-shot adapter and renderer model.

Run the affected package's documented checks; include QML integration checks for
bridge or renderer changes. Existing tests can establish behavior preservation
without adding tests that mirror the new structure. Inspect the diff for changed
visibility, imports, error propagation, and process cleanup. Report verification
and any uncovered risk.

Adapted for this repository from [haiyizxx/codex-skills](https://github.com/haiyizxx/codex-skills).
