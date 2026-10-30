# Repository conventions

- Treat this file as repository policy. Skills in `.agents/skills/` provide
  task-specific guidance; explicit user instructions take precedence.
- Keep changes focused on the requested task. Preserve unrelated working-tree
  edits and include only intended files when committing.
- This repository is in active development. Do not add legacy migrations,
  backward-compatibility layers, or old-format fallbacks.
- Installing or configuring apps replaces the declared destination files and
  folders. Do not create backups or preserve their previous contents. Leave
  paths outside those exports untouched; keep validation and safe writes.

- Keep each package's `README.md` short: what it does, the minimum setup, and one
  working usage example. Link to the package's `DOCS.md` for everything else.
- Keep each package's `DOCS.md` brief, direct, and easy to scan: APIs, essential
  behavior, errors, real limitations, and relevant setup/test commands. Avoid
  essays, boilerplate, repetition, and implementation walkthroughs.
- Document only what users need for that package. List external dependencies
  only when they need separate installation. Omit generic toolchain reminders
  and other packages' requirements; link elsewhere only when needed for use.
- Put implementation in `src/` and tests and fixtures in `tests/`.
- Split implementation into focused modules by responsibility. Keep entry points
  small and related logic together so files are easy to read and understand;
  avoid giant files and unnecessary abstractions.
- Prefer direct control flow and existing helpers. Split by responsibility,
  without arbitrary file-size limits or layers added only to shorten a file.
- Keep comments that explain intent, invariants, caller constraints, or
  non-obvious tradeoffs. Use API docs for caller-relevant behavior and errors;
  avoid comments that repeat the code or compensate for unclear names.
- Use `.agents/skills/code-comments/SKILL.md` for code-comment and API-doc work;
  apply it when adding or changing implementation too. Explain meaningful public
  contracts and non-obvious mechanisms; verify claims against implementations
  and callers rather than adding comments to meet a count.
- Keep `packages/hocon` a standalone Rust configuration helper. Preserve includes
  and unrelated source text when editing; never save resolved data over the file.
- Keep `packages/hocon-qml` a separate, one-shot adapter exposing only
  `Config.load_as_json(path, schemaPath?)`. Return a plain JavaScript object for
  the app to hold in memory; do not add watchers, caches, live getters, or editing
  methods.
- Apps own their JSON Schemas. Use the HOCON helper's optional schema validation
  on resolved values; keep schema reference resolution offline and defaults in
  the app. Do not duplicate schema rules in handwritten validators.
- Keep shared application operations in `packages/luna-next`; CLI code handles
  arguments, prompts, and output. Standard wallpaper config mutations validate
  and save atomically, then explicitly reload the running renderer. Keep full
  process replacement for `restart`; do not add configuration file watchers. Failed
  application restores the previous source without overwriting external edits.
- Preserve explicit file paths, automatic missing-file creation, and null values
  for missing Rust keys. Apps choose configuration paths; do not add environment
  selection or reload APIs to either configuration package.
- Optimize measured or clearly unnecessary work without weakening source
  preservation, include resolution, or safe writes. Run relevant Rust and QML
  checks for implementation changes.
- Use each package's `DOCS.md` for build and test commands. The Cargo workspace
  defaults to `packages/hocon`; select changed packages explicitly or use
  `--workspace` when checking shared changes.
- Add regression coverage for bugs and meaningful behavior changes. Reuse
  existing coverage for structural refactors; documentation-only changes need
  link, example, and instruction checks rather than unrelated runtime suites.

## Pull request delivery

- Deliver changes on a feature branch through a pull request. Run the relevant
  checks, commit and push the intended files, then open the PR.
- Get an independent review of the pushed PR and post its findings briefly in
  the PR. Fix the findings, rerun the relevant checks, and push the fixes.
- Add a follow-up PR comment describing the fixes and validation. Merge after
  the review is addressed and required checks and approvals are satisfied.
- Include this small credit in every PR description and every GitHub comment,
  including review findings and follow-up comments. Commit messages do not need it:
  `<sub>🤖 Co-authored by Codex</sub>`.
