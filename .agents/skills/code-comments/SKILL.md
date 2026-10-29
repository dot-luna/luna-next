---
name: code-comments
description: Write, complete, or review code comments and API documentation in Luna Next's Rust, QML, JavaScript, and C++ bridge code. Use for comment requests and non-obvious contracts affected by implementation changes; preserve executable behavior.
---

# Code Comments

Follow [AGENTS.md](../../../AGENTS.md). Cover the reader's material knowledge
gaps within the requested scope, including initially uncommented code. Prefer
supported explanations over comment counts, word quotas, or boilerplate.

## Scope and evidence

- For a comment-only request, change comments and docstrings only. For a review,
  report findings without editing. Installing this skill does not authorize a
  repository-wide comment pass.
- In new code, inspect public contracts and non-obvious private mechanisms. In
  existing code, cover changed declarations, operations, and affected comments;
  a full comment audit covers the files or symbols the user selected.
- Read implementations, callers, tests, and schemas before asserting defaults,
  ownership, ordering, errors, units, or recovery behavior. Check exceptional
  paths before promising atomicity, thread safety, or independent copies.
- Separate guarantees from caller obligations. Report unsupported or ambiguous
  behavior instead of inventing design motives, incidents, or assurances.
- Preserve licenses, generated-file markers, compiler/lint directives, and
  tool-consumed comments. Leave generated and vendored code unchanged.

## Choose what to explain

| Subject | Useful explanation |
| --- | --- |
| Public API | Purpose, inputs/results, meaningful defaults, errors, side effects, and caller obligations |
| Private helper | Intent, invariant, or surprising behavior not clear from its name and body |
| Type or field | Ownership, units, encoding, special values, or shared relationships affecting use |
| Local operation | Why recovery, persistence ordering, synchronization, fallback, or cleanup is necessary |
| Module or component | Responsibility and an important relationship needed to navigate or maintain it |
| Test setup | Unusual fixture, timing, isolation, or failure scenario not expressed by the test name |

Document meaningful contracts fully. Expand an explanation when interacting
rules need context, and keep straightforward definitions brief. An obvious
getter, field, or assertion needs no comment merely to fill a coverage quota.

Prioritize this repo's source-preserving HOCON edits, include resolution, offline
schema validation, missing/null distinctions, conflict-safe writes and rollback,
renderer restart behavior, and child-process ownership when the task touches them.
Keep each rule at its owner; do not copy it across every wrapper and caller.

## Place and phrase it

- Rust: use `///` for item contracts and `//!` for useful module/crate overviews.
  Put module docs before items and imports, following any required file headers.
  Use rustdoc links and examples only when they help callers.
- QML/JavaScript: put comments beside the property, signal, lifecycle handler, or
  operation they explain. Describe when resources are owned and released.
- C++ bridge: follow nearby style. Explain engine ownership, byte lifetimes,
  exception conversion, or JavaScript conversion where relevant.
- Use English, present tense, exact symbols, and concrete conditions. Explain
  intent and failure consequences rather than narrating adjacent expressions.
- Keep caller rules at declarations, shared rules at their type/module, and
  local ordering reasons beside operations. Cross-references can connect these
  without repeating them.
- Keep package setup and broad usage in the short README and DOCS.md structure.
  Comments should not become installation guides or implementation essays.

Read [examples.md](references/examples.md) for contract and operation examples,
and [file-overviews.md](references/file-overviews.md) when adding a module or
component overview. Examples show comment wording, not replacement code.

## Review and validate

Read explanations alongside their full context. Check accuracy, missing caller
rules, repetition, placement, and whether each comment adds useful information.
Update stale comments affected by the task and inspect placement after formatting.
For comment-only work, check the diff and any affected documentation links. Run
rustdoc checks when changing intra-doc links or executable examples; use package
checks if executable code also changes. Report comment review separately from
runtime verification. Use [evaluation.md](references/evaluation.md) only when
comparing revisions of this skill.

Adapted for Luna Next from [smartcmd/code-comments](https://github.com/smartcmd/code-comments),
with Rust/QML examples and coverage based on reader needs rather than minimum lengths.
