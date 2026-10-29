# Comparing comment-skill revisions

Use this only when maintaining the skill. Ordinary comment edits need review of
the requested scope, not a benchmark or additional tooling.

Compare revisions using the same source files, repository policy, task, and
starting comments. Include a public API, non-obvious private code, fields with
units or ownership rules, source-preserving edits, rollback, and QML lifecycle
handling. Keep trial output outside the working tree.

Read original diffs before making corrections. Assess whether a reader can use
the API and preserve important constraints, then check:

- Claims supported by implementation, callers, tests, and exceptional paths.
- Missing contracts, ownership obligations, or ordering reasons.
- Repetition, obvious narration, invented motives, and unnecessary expansion.
- Correct rustdoc and ordinary-comment placement after formatting.
- Preservation of executable code for comment-only requests.

Report representative passages and their evidence. Comment quality and runtime
tests establish different things; report each honestly. Improvement on sampled
files does not establish a guarantee for the entire repository. Do not use word
counts as a substitute for usefulness or accuracy.
