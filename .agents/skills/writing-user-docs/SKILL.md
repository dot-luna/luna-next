---
name: writing-user-docs
description: Write or review Luna Next package READMEs, DOCS.md files, CLI usage, and setup instructions. Keep documentation short, accurate, and useful to the package's users; exclude internal design notes and code comments.
---

# User-facing documentation

Follow the documentation policy in [AGENTS.md](../../../AGENTS.md). Write for
the person using the affected package: a Rust caller, QML app author, CLI user,
or wallpaper user.

## Choose the right document

- Keep `README.md` to purpose, minimum setup, one working usage example, and a
  link to `DOCS.md`. Update it when the quick start changes.
- Put API contracts, essential behavior, errors, real limitations, and relevant
  build/test commands in a brief, scannable `DOCS.md`.
- Document the affected package. Link to another package only when its setup or
  contract is needed for use; avoid copying its requirements or instructions.
- List external dependencies only when users must install them separately.
  Keep implementation walkthroughs and generic toolchain reminders out.

## Explain the contract

- Read the API, schema, CLI definitions, tests, and existing docs before writing.
  Use maintained sources to establish behavior rather than inferring guarantees.
- Explain caller-visible path handling, missing-file creation, missing and null
  values, validation errors, side effects, and recovery when relevant to use.
- Distinguish Rust, QML, shared API, CLI, and renderer behavior. For example,
  CLI config changes apply automatically; direct file edits need a restart.
- Keep defaults in the app and schema rules in the schema. Explain only the
  settings or examples a reader needs; link to the maintained reference.
- Put required setup and meaningful limits before the steps they affect.

## Write and check

- Use plain language, active verbs, exact API names, and small tables or lists
  where they make contracts easier to scan.
- Cut marketing claims, welcome text, repeated explanations, roadmap promises,
  and unsupported benefits.
- Prefer one realistic, minimal example. Check paths, imports, command flags,
  exit behavior, and output against the source. Run changed executable examples
  when practical; avoid commands that alter a live desktop merely to check prose.
- Verify local links and remove stale instructions. Report any example or
  behavior that could not be checked.

Adapted for this repository from [Callstack's agent skills](https://github.com/callstackincubator/agent-skills).
