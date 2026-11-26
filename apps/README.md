# App configurations

Luna app packages, native defaults, and lifecycle scripts. The ordered
[apps.jsonc](apps.jsonc) index selects manifests; each app keeps its declarations
in `app.jsonc` and optional `config/` and executable `scripts/` folders.

From an installed Luna checkout:

Set `enabled` to `false` in an app's `app.jsonc` to skip its installation.
An omitted flag or `true` enables it.

```sh
luna install kitty
```

See [DOCS.md](DOCS.md) for lifecycle, exports, dependencies and retries, and
[app.example.jsonc](app.example.jsonc) for manifest fields.
