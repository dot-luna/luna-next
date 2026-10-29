---
name: karpathy-guidelines
description: Keep Luna Next changes simple, scoped, and verifiable. Use for non-trivial implementation with uncertain requirements, competing approaches, or a risk of overengineering.
---

# Karpathy Guidelines

Use [AGENTS.md](../../../AGENTS.md) as repository policy. Keep the workflow
proportional to the task; routine edits do not need a planning template.

## Before changing code

- Inspect the actual code, relevant package docs, tests, and working-tree changes.
- State assumptions only when they affect behavior or design. Infer routine
  choices from existing conventions and continue with authorized work.
- Ask for clarification only when missing information materially changes the
  result and cannot be resolved from the repository or conversation.
- For non-trivial work, identify an observable outcome and the check that will
  establish it. Avoid turning implementation preferences into new requirements.

## Keep the solution small

- Reuse the existing configuration helper, one-shot QML adapter, shared app API,
  and test harnesses. Keep responsibilities in the owners named by `AGENTS.md`.
- Add only the behavior requested. Introduce options, abstractions, dependencies,
  or state only when the current task needs them.
- Preserve validation, safe writes, external-edit protection, and process cleanup
  when simplifying. Small code still needs to uphold its contracts.
- Prefer focused modules and small diffs. Remove only code made obsolete by the
  task, and preserve unrelated work when staging or committing.
- If the change grows unexpectedly, reconsider the design and continue with the
  smallest approach that satisfies the request.

## Establish the result

Use the affected package's documented checks, including QML checks when its
behavior changes. Test meaningful outcomes and failure paths rather than code
layout. Report what changed, what ran, and what remains unverified.

Adapted from [haiyizxx/codex-skills](https://github.com/haiyizxx/codex-skills),
Forrest Chang's `karpathy-guidelines`, and Andrej Karpathy's observations on
coding-agent pitfalls.
