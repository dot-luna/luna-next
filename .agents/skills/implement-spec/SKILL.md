---
name: implement-spec
description: Implement a user-authorized Luna feature specification within its selected scope, verify acceptance cases, and deliver the change through repository review rules. Use when asked to implement a spec; writing, reviewing, or merging a spec alone does not authorize implementation.
---

# Implement a specification

Implement the selected behavior and acceptance cases. Future phases, rejected
ideas, and examples in a spec are not permission to expand the assignment.

## Establish the implementation boundary

1. Read the specified document, accepted user corrections, applicable AGENTS
   files, nearby code, callers, and tests. Confirm the user has authorized
   implementation and identify the selected phase or requirements. A document's
   existence or merge alone is not authorization; an explicit request to
   implement can authorize work on a draft.
2. Inspect the initial working-tree diff and preserve unrelated edits. Establish
   the current runtime, package, and configuration constraints before designing.
3. Resolve contradictory or missing product rules with the user and, where
   useful, [write-spec](../write-spec/SKILL.md). Continue independent work without
   silently changing the contract. Routine implementation choices do not need
   another approval.

## Apply relevant guidance

- Use [clean-code](../clean-code/SKILL.md) and
  [karpathy-guidelines](../karpathy-guidelines/SKILL.md) for ownership and scope.
- Apply [code-comments](../code-comments/SKILL.md) to affected contracts and
  non-obvious mechanisms, and
  [typescript-argument-design](../typescript-argument-design/SKILL.md) when
  designing or changing TypeScript/JavaScript signatures.
- Use [writing-user-docs](../writing-user-docs/SKILL.md) for package user
  documentation, [systematic-debugging](../systematic-debugging/SKILL.md) for
  failures, and
  [verification-before-completion](../verification-before-completion/SKILL.md)
  before claiming results. Load only guidance relevant to the current work.

## Implement and verify

- Map selected requirements to observable behavior and relevant checks. Reuse
  existing coverage for structural changes; add regression coverage for bugs
  and meaningful behavior changes. Avoid tests that merely mirror code layout.
- Use existing owners: shared operations and feature schemas in `packages/luna-api`,
  CLI arguments/prompts/output in `src/luna-cli`, application implementation in
  its `src/` package, and app integration declarations in `apps/`.
- Update in-scope callers and remove superseded paths. Preserve safe writes,
  source ownership, validation, explicit reloads, and cleanup. Follow
  [repository policy](../../../AGENTS.md) rather than adding compatibility layers
  or unrelated refactors.
- Use the affected package's `DOCS.md` for checks. Select affected Bun packages
  explicitly or workspace checks for shared changes; run relevant Rust and QML
  checks when those implementations change. Keep fixtures isolated from the
  user's actual configuration, session, and hardware.
- Inspect the final diff, run `git diff --check`, and account for the selected
  acceptance cases. Report skipped checks, unavailable infrastructure, and
  pre-existing failures accurately. Do not describe unverified behavior as done.

## Deliver and address review

Follow [repository PR delivery](../../../AGENTS.md#pull-request-delivery) using
the user's existing authorization; honor narrower local-only requests. Choose
the base from the user's instruction or repository context and verify it.

1. Commit and push only intended files. Open or update a focused PR describing
   resulting behavior, the spec and selected requirements, and actual checks.
   Follow the environment's PR-linking requirements.
2. Obtain an independent review of the pushed diff against the selected spec.
   Provide scope, base/head, relevant source/tests, and verification evidence
   without suggesting a verdict. The reviewer returns findings and does not
   mutate files, publish comments, or delegate again unless explicitly assigned.
3. Post concise findings, including a no-findings result when applicable, with
   the attribution required by AGENTS.md. Investigate defects and fix confirmed
   in-scope issues. Explain deferred or non-actionable findings.
4. Rerun affected checks, push fixes, and post a separate follow-up comment
   describing corrections and validation. Obtain another independent review
   for material changes when needed; small verified fixes do not require a new
   reviewer. Do not claim local-only fixes are already in the PR.
5. Follow repository merge requirements once review is addressed and required
   checks and approvals are satisfied. Use the environment's PR wait workflow
   when needed. Disclose unavailable review or publishing access instead of
   claiming the pending step is complete. Do not start deferred phases.

Adapted from [Lazy Wallet's implement-spec skill](https://github.com/jrTilak/lazy-wallet/tree/e72014c1337e5fb0befe030430607688af1351ae/.agents/skills/implement-spec).
