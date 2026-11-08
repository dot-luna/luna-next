# Feature requirements guide

Write enough detail that implementation and acceptance testing do not require
guessing. These are coverage questions for relevant behavior, not a mandatory
outline or permission to add features.

## Purpose, scope, and evidence

- State the user outcome, owning modules, document date, and review status.
  Link the issue or PR when one exists.
- Identify included behavior, explicit exclusions, and deferred work. Define
  domain terms that would otherwise have multiple meanings.
- Establish current behavior with source links, then describe intentional
  changes. Mark unverified claims and implementation gaps.
- Distinguish accepted decisions from proposals and open questions. A blocking
  product decision means the contract is not implementation-ready.

## Functional requirements and lifecycle

- Give requirements stable feature-prefixed IDs. State actor, preconditions,
  operation, observable result, and invalid transitions.
- Cover creation, selection, updates, removal, startup, reload, restart, and
  shutdown only where the feature needs them. Define resource ownership and
  cleanup across success, cancellation, and failure.
- Explain defaults, selection precedence, unsupported capabilities, and how
  changes affect current and future operations.
- Assign responsibilities to existing modules without prescribing unnecessary
  classes, layers, or a generic framework.

## API, CLI, and UI contracts

- Define each affected public operation and its authorization requirements.
  Specify input names, types, requiredness, omitted/null semantics, defaults,
  bounds, allowed values, normalization, and cross-field conditions.
- Define result fields, units, nullable values, and errors using the owning
  API's actual response contract. Do not invent existing capabilities or error
  codes. Clearly label proposed contract changes.
- For CLI work, specify arguments, flags, output, exit behavior, and prompts.
  Preserve the API/CLI responsibility boundary.
- For UI work, describe loading, empty, unsupported, success, and error states
  that matter to the task. Cover keyboard and mouse navigation, focus,
  activation, dismissal, and accessible names. Input must not wait for animation.
- Include valid examples and meaningful rejection cases. Examples must satisfy
  the specified field rules. Describe HTTP routes only if HTTP is in scope.

## Configuration, state, and side effects

- Identify configuration ownership, explicit paths, missing-file behavior, and
  null handling. Distinguish author-written sources from in-memory defaults.
- Define where validation happens and how consumers reuse the owning schema.
  Follow repository policy for formats, reads, and explicit reloads.
- Describe atomic write boundaries, partial failures, recovery, and external
  edits. Define which state wins when relevant operations overlap.
- Explain retries and cancellation where they change observable behavior. Do
  not promise exactly-once effects or add persistent infrastructure without a
  concrete requirement.
- Distinguish saved settings from applied runtime state. State what happens if
  applying a saved change fails, a process exits, or a required service or
  hardware capability is unavailable.
- For app integration, define owned exports and external dependencies without
  expanding changes to unrelated destinations. Respect the repository's
  compatibility policy rather than introducing migrations by default.

## Acceptance and verification

Map requirement IDs to observable scenarios and an appropriate planned check:
unit, API/CLI integration, isolated process or filesystem tests, QML interaction,
or manual desktop/hardware validation.

- Cover success, boundaries, rejected inputs, cancellation, concurrent edits,
  and partial failure where they affect the feature.
- Test cross-module contracts, not just isolated helper calls. Keep tests from
  altering the user's real settings, desktop session, or hardware.
- Use affected packages' documented commands. Distinguish planned implementation
  checks from document checks actually run; future tests are not passing tests.
- Identify manual checks and environmental limitations without claiming results
  from unavailable devices, services, or desktop sessions.
- Describe implementation order only when needed to explain dependencies; keep
  speculative code and large task hierarchies out of the requirements.

Before delivery, check that requirements, examples, acceptance cases, review
findings, and accepted user scope agree. Follow repository PR policy when PR
delivery is in scope, then stop before implementation unless separately asked.
