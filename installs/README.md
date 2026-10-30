# Package lists

[packages.conf](packages.conf) groups packages into arrays of objects:

```hocon
core = [
    {
        name: "git",
        source: "pacman",
        version: null,
        url: null,
        purpose: "Version control"
    }
]
```

| Field | Meaning |
| --- | --- |
| `name` | Package, app, or tool name. |
| `source` | `pacman` for official Arch packages, `aur` for AUR packages, `git` for a Git repository, `local` for a local app/package, or `mise` for a development tool. |
| `version` | Optional mise version or Git branch/tag. Git `latest` selects the highest eligible tag using Git's version sorting. Omitted/`null` uses Git's default branch on first clone. |
| `git_include_prereleases` | Include SemVer prerelease tags with `latest`; defaults to `false`. |
| `git_release_tag_pattern` | Optional tag-name glob for `latest`, e.g. `v*` or `release/*`. Omit to consider all tags. |
| `url` | Repository URL for `git`, a source path for `local`, or `null` for other sources. |
| `purpose` | A short explanation of why the package is included. |
| `destination` | Optional local link path relative to `~/.local`; defaults to `src/<name>`. |
| `command` | Argument arrays run in the Git checkout or local source directory. Empty for a local package needing only a link. |

`packages.git.conf`, `packages.mise.conf`, and `packages.local.conf` contain bare
arrays. Local `url` paths resolve from this checkout. Keep build/install steps in
the project and call its task, for example `[["mise", "run", "install:hocon-qml"]]`.

[packages.webapp.conf](packages.webapp.conf) is a separate array of desktop web
apps, currently YouTube. Entries use `name` and `url`, with optional `icon_url`
to override website icon discovery:

```hocon
[{ name: "YouTube", url: "https://www.youtube.com/" }]
```

`luna setup` validates this list before installing packages. When it is nonempty,
setup creates a missing Luna Chromium profile before configuring apps, then
installs the web apps after enabling keyring. It never opens a browser. Entries
share the default Luna profile; reruns replace their desktop entries and icons.
An empty array disables this stage. Missing or invalid lists stop setup.

Git/local recipes receive the catalog checkout as `$LUNA_NEXT_ROOT`. Git recipes
also receive the selected ref as `$LUNA_PACKAGE_VERSION` (`v1.2.3`, not `latest`).
Tag filters apply only to `latest`; explicit branches/tags are unchanged.
Without a pattern, an untagged remote uses its default branch. No matching or
eligible tags returns an error. Prerelease detection recognizes SemVer tags with
an optional `v`; other tag names remain eligible.

The [T3 recipe](../apps/t3code/DOCS.md) builds the x86_64 Linux app with Luna's
boxy UI and defaults, then installs a launcher into `~/.local/bin/t3code`:

```sh
luna install --git t3code
```

The Chromium provider is the prebuilt AUR `ungoogled-chromium-bin` package:

```sh
luna install ungoogled-chromium-bin
luna chromium setup
```

Its installation runs in a separate package-manager transaction that accepts
conflicting Chromium/chromedriver replacement. Package-manager dependency checks
remain active; browser profile files are retained. Package-only installation
leaves a missing Luna profile for the explicit setup step; full `luna setup`
creates it when web apps are declared. See [Chromium setup](../apps/chromium/DOCS.md).

Zen uses the prebuilt AUR `zen-browser-bin` package:

```sh
luna install zen-browser-bin
```

Installation and full setup configure Zen's existing default profile with Luna's
appearance, uBlock Origin, and Bitwarden. Close Zen first. A missing profile is
skipped; open Zen once, close it, then run `luna conf zen`. No Zen profile is
created by Luna. See [Zen configuration](../apps/zen/DOCS.md).
