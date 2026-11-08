---
name: systematic-debugging
description: Investigate Luna bugs, failing checks, unexpected behavior, and performance regressions by tracing evidence to a cause before changing code.
---

# Systematic Debugging

Follow [AGENTS.md](../../../AGENTS.md) and the user's scope. A request for
read-only diagnosis does not authorize a fix.

## Establish the failure

- Read the complete error and relevant logs, then identify the smallest reliable
  reproduction. If the problem is intermittent, record the conditions and gather
  evidence before guessing at a fix.
- Inspect recent changes, relevant callers, package documentation, and working
  examples. Distinguish an application defect from missing dependencies or an
  unsupported environment.
- Trace the failing value or operation backward to its source. For failures
  across API, CLI, process, or QML boundaries, inspect what enters and leaves each
  boundary until the failing component is clear.
- Add temporary diagnostics only when needed and within the authorized scope.
  Keep secrets out of logs and preserve unrelated working-tree changes.

## Test a specific explanation

State the suspected cause and the evidence supporting it. Compare the failing
path with a working one, then test one explanation with the smallest meaningful
check or change. A failed hypothesis should change the investigation; avoid
stacking speculative fixes.

For timing failures, prefer an observable event or condition with a bounded
timeout over an arbitrary delay. Keep delays when elapsed time is the behavior
under test. Use existing test helpers where available.

## Fix and verify

- Once the cause is established and implementation is authorized, fix it in its
  owning module. Preserve shared validation, safe writes, and process cleanup;
  do not duplicate schemas across consumers or broaden the task into a cleanup.
- Add regression coverage for a bug or meaningful behavior change. Where
  practical, demonstrate that the reproduction fails before the fix and passes
  after it, without disturbing unrelated work.
- Run the affected package's documented checks, including Rust or QML checks
  when those layers change. Use
  [verification-before-completion](../verification-before-completion/SKILL.md)
  to report the evidence and any remaining limits.
- If attempts keep failing or require changes across unrelated components,
  revisit the assumptions and ownership boundaries. Continue useful diagnosis;
  ask for input only when a missing fact or scope decision prevents progress.
- If evidence points to an environmental or external cause, report what was
  observed and what remains uncertain. Recommend handling supported by that
  evidence rather than adding speculative retries or fallbacks.

Adapted from the copy in
[jrTilak/lazy-wallet](https://github.com/jrTilak/lazy-wallet), originally from
[obra/superpowers](https://github.com/obra/superpowers/tree/main/skills/systematic-debugging).
The upstream [MIT license](LICENSE.txt) is retained.
