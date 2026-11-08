---
name: verification-before-completion
description: Verify evidence before reporting Luna work complete, a bug fixed, or checks passing, including commit and pull request handoffs.
---

# Verification Before Completion

Follow [AGENTS.md](../../../AGENTS.md). Match each completion claim to evidence
from the current changes; confidence or an agent's report alone is insufficient.

## Choose evidence for the claim

- Read the affected package's `DOCS.md` for its check commands. Select affected
  Bun packages explicitly; use workspace checks when shared changes require
  them. Include relevant Rust and QML checks when those layers change.
- For a bug fix, exercise the original failure or its regression test. For a
  behavior change, check the requested outcome and meaningful failure paths.
  Existing coverage can establish a structural refactor's behavior.
- For documentation or skill changes, check referenced paths, examples, and
  instructions. Use applicable validators instead of unrelated runtime suites.
- Review the final diff against the requested scope and preserve unrelated
  changes. Tests passing alone do not establish that every requirement is met.

## Run and inspect

Run the necessary checks and inspect their actual exit codes and results. A
partial run, skipped test, or unavailable dependency is a limitation to report,
not proof that the full check passed. A successful lint run does not establish
that a build succeeds.

Evidence remains usable while the relevant code and environment are unchanged.
Rerun checks after changes that affect their result, or when a failure or new
concern warrants it; do not repeat successful checks solely to send an update.

When an agent contributes work, inspect its diff and verification evidence.
Run missing checks or resolve gaps rather than accepting its completion summary
as proof or automatically repeating valid checks.

## Report the result

State what changed, what was checked, and any material limitation. Distinguish
local validation, CI results, review status, and merge status. Report failures
and unverified behavior directly, and keep PR delivery within the authorization
and workflow in `AGENTS.md`.

Adapted from the copy in
[jrTilak/lazy-wallet](https://github.com/jrTilak/lazy-wallet), originally from
[obra/superpowers](https://github.com/obra/superpowers/tree/main/skills/verification-before-completion).
The upstream [MIT license](LICENSE.txt) is retained.
