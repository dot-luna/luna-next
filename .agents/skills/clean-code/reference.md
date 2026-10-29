# Luna Next checks

Read this when choosing validation for an implementation or refactor. Repository
policy lives in [AGENTS.md](../../../AGENTS.md); package docs describe setup and
limitations. Run commands from the repository root.

## Select the affected layer

| Change | Relevant checks |
| --- | --- |
| HOCON helper | `cargo test -p luna-next-hocon` and, for schema behavior, `cargo test -p luna-next-hocon --features schema` |
| Rust/QML bridge | `cargo test -p luna-next-hocon-qml`; rebuild with `mise run build:hocon-qml`, then `ctest --test-dir target/hocon-qml --output-on-failure` for QML integration |
| Shared application operations | `cargo test -p luna-next`; also CLI or renderer checks when their contracts change |
| CLI arguments, prompts, or output | `cargo test -p ln-cli` |
| Wallpaper QML | After building the config module, `python3 -m unittest discover -s src/luna-wallpaper/tests -v` |

Use targeted test names during iteration. Select packages explicitly: plain
`cargo test` checks only the default HOCON member. Shared Rust changes may warrant
`cargo test --workspace --all-features`. Check Rust formatting with
`cargo fmt --all -- --check`; do not reformat unrelated working-tree changes.
Run QML integration checks when Rust bridge changes affect QML-visible behavior.

For documentation or skill edits, validate local links, manifests where present,
and examples against their maintained source. Run executable examples when their
behavior changes; do not run runtime suites merely for wording edits. Report
missing tools or skipped tests without counting them as passes.

## Preserve observable contracts

Choose assertions around the behavior affected by the change:

- HOCON edits: original source, comments, includes, include precedence, symlinks,
  permissions, atomic replacement, and conflicts with external edits.
- Schema validation: resolved values, offline references, no inserted defaults,
  and rejection before saving invalid settings.
- QML adapter: one load returning a plain JavaScript object; Rust missing keys
  remain null while absent JavaScript properties remain `undefined`.
- App mutations: validation, atomic save, automatic renderer restart, and exact
  source restoration after failure only when no external edit would be lost.
- Renderer lifecycle: readiness, errors, child-process cleanup, and media
  ownership. Use the existing offscreen harness and fake player.
- CLI: argument parsing, exit codes, prompts, and JSON output through the shared
  application API rather than duplicated operations.

Use temporary paths and fake processes. Existing runtime tests avoid changing a
live desktop. Offscreen tests do not prove Wayland placement or hardware decoding.

## Setup and details

- [HOCON](../../../packages/hocon/DOCS.md)
- [QML adapter](../../../packages/hocon-qml/DOCS.md)
- [Shared app operations](../../../packages/luna-next/DOCS.md)
- [CLI](../../../src/ln-cli/DOCS.md)
- [Wallpaper renderer](../../../src/luna-wallpaper/DOCS.md)
