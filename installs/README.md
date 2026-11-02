# Package lists

Package recipes for Luna's installer, written in JSONC (JSON with comments and
trailing commas). `luna self install` processes `before_cli`, `after_cli`, and
the mise list, apps, `later`, and finally web apps through the shared web-app API.

Packages installed by [install.sh](../install.sh) may also appear in these lists.
Packages declared in [apps/](../apps/README.md), as an app's `name` or in its `deps`,
must never appear in these lists.
Keep general tools, editors, and shared runtimes here. Only packages directly
tied to an app, such as its plugins, belong in that app's `deps`.
Dependencies for inactive local desktop apps are omitted; add them when enabling
those apps.

| File                                           | Contents                                               |
| ---------------------------------------------- | ------------------------------------------------------ |
| [packages.jsonc](packages.jsonc)               | Pacman and AUR packages grouped by installation stage. |
| [packages.mise.jsonc](packages.mise.jsonc)     | Array of development tools and runtime versions.       |
| [packages.webapp.jsonc](packages.webapp.jsonc) | Array of desktop web apps with only `name` and `url`.  |

Add system packages to the appropriate group in `packages.jsonc`:

- `before_cli`: before building and installing the CLI.
- `after_cli`: after the CLI is ready, before installing apps.
- `later`: after apps are installed. Web apps run last.

```jsonc
{
  "before_cli": [{ "name": "mise", "source": "pacman", "purpose": "Manage runtimes" }],
  "after_cli": [{ "name": "unzip", "source": "pacman", "purpose": "Extract browser extensions" }],
  "later": [{ "name": "zed", "source": "pacman", "purpose": "Code editor" }],
}
```

Each package recipe has a `name` and `source` (`pacman`, `aur`, or `mise`).
Use `purpose` for a short description and `version` to select a mise version.

See [example.jsonc](example.jsonc) for the package fields and source examples.
Its entries illustrate recipes; it is not an additional install list. App
configuration exports and lifecycle hooks belong in [apps/](../apps/README.md).
