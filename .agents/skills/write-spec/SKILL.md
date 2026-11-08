---
name: write-spec
description: Write, update, or independently review Luna feature specifications grounded in code and accepted user decisions. Use for API, CLI, desktop behavior, configuration contracts, and acceptance criteria before implementation; does not authorize implementing the feature.
---

# Write a feature specification

Turn the user's decisions into a reviewable behavior contract. Support writing,
updating, and independently reviewing a spec. Existing code establishes the
baseline; it does not automatically define the desired design.

## Establish scope

- Read [AGENTS.md](../../../AGENTS.md), the user's accepted decisions, and the
  affected implementation, callers, tests, and package documentation.
- Separate confirmed scope, rejected features, deferred work, proposed defaults,
  and unresolved questions. Do not treat assumptions as user approval.
- Ask only about missing product decisions that block a coherent contract;
  continue work that does not depend on the answer.
- Write specifications only. A spec request does not authorize feature code,
  installation, configuration changes, service operations, or hardware writes.

## Write or update

1. Read the relevant sections of the [FRS guide](references/feature-frs.md).
   Scale the document to the feature; omit irrelevant sections rather than
   inventing requirements to fill a template.
2. Use the user's path when supplied. Otherwise write
   `specs/YYYY-MM-DD-frs-<feature>-spec.md` using the user's local date. Give
   requirements stable IDs and observable acceptance criteria. Resolve source
   links relative to the spec file.
3. Describe current behavior and intended changes separately. Identify the
   owning API, CLI, renderer, or app integration, and follow the repository's
   existing ownership and configuration conventions.
4. Define inputs, results, failures, state transitions, and side effects. Explain
   partial failure and conflicting changes when relevant. Keep implementation
   suggestions separate from required behavior.
5. Check examples against field rules and acceptance cases. Use
   [systematic-debugging](../systematic-debugging/SKILL.md) for contradictions:
   walk a concrete request or state transition through the spec, identify the
   conflicting rule, then correct it and repeat the scenario.

Use [karpathy-guidelines](../karpathy-guidelines/SKILL.md) to keep scope focused
and [clean-code](../clean-code/SKILL.md) when module responsibilities need review.
Use [writing-user-docs](../writing-user-docs/SKILL.md) only when package user
documentation is also in scope; a feature spec is a different artifact.

## Review and deliver

- Respect local-draft and review-only requests. Otherwise follow
  [repository PR delivery](../../../AGENTS.md#pull-request-delivery), including
  independent review, findings and follow-up comments, attribution, and merge
  requirements. Derive the base from the user's instruction or repository
  context and verify it; do not reuse another project's branch name.
- Give the independent reviewer the accepted scope, spec, and relevant source
  locations without suggesting a verdict. If review is unavailable, report
  the remaining step rather than claiming independent review.
- Fix confirmed document defects and amend acceptance scenarios. A material
  contract change may need another independent review; a small correction does
  not require repeating the entire review workflow.
- Check links, examples, internal consistency, and `git diff --check`. Use
  [verification-before-completion](../verification-before-completion/SKILL.md)
  to distinguish checks actually run from future implementation tests.
- Report the spec location, unresolved decisions, review findings, and checks.
  Stop before feature implementation. A merged spec alone is not authorization
  to start implementation; the user's instruction must authorize that work.

## Independent review mode

Review the complete feature contract against accepted user decisions and cited
code. Trace relevant API calls, CLI actions, UI interactions, configuration
changes, and process lifecycles through success and failure.

Exercise missing/null/zero inputs, unsupported capabilities, invalid paths,
retries, concurrent changes, and partial failures where applicable. For UI work,
check keyboard and mouse navigation, activation, dismissal, and focus behavior.
Do not turn deferred work or optional improvements into defects.

Return findings first: severity, document path and line, triggering scenario,
user-visible impact, conflicting or missing rule, and a focused correction with
an acceptance case. If none, state what was reviewed and remaining limits.
Review-only work does not authorize edits or remote comments. Return findings
to the coordinator unless explicitly assigned publication; do not delegate a
review assignment again.

Adapted from [Lazy Wallet's write-spec skill](https://github.com/jrTilak/lazy-wallet/tree/e72014c1337e5fb0befe030430607688af1351ae/.agents/skills/write-spec).
