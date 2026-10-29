# Package conventions

- Keep each package's `README.md` short: what it does, the minimum setup, and one
  working usage example. Link to the package's `DOCS.md` for everything else.
- Keep each package's `DOCS.md` brief, direct, and easy to scan: APIs, essential
  behavior, errors, real limitations, and relevant setup/test commands. Avoid
  essays, boilerplate, repetition, and implementation walkthroughs.
- Document only what users need for that package. List external dependencies
  only when they need separate installation. Omit generic toolchain reminders
  and other packages' requirements; link elsewhere only when needed for use.
- Put implementation in `src/` and tests and fixtures in `tests/`.
- Keep `packages/hocon` a standalone Rust configuration helper. Preserve includes
  and unrelated source text when editing; never save resolved data over the file.
- Keep `packages/hocon-qml` a separate, one-shot adapter exposing only
  `Config.load_as_json(path)`. Return a plain JavaScript object for the app to hold
  in memory; do not add watchers, caches, live getters, or editing methods.
- Preserve explicit file paths, automatic missing-file creation, and null values
  for missing Rust keys. Apps choose configuration paths; do not add environment
  selection or reload APIs to either configuration package.
- Optimize measured or clearly unnecessary work without weakening source
  preservation, include resolution, or safe writes. Run relevant Rust and QML
  checks for implementation changes.
