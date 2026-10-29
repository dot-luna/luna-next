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

Git recipes receive the selected ref as `$LUNA_PACKAGE_VERSION` (`v1.2.3`, not
`latest`). Tag filters apply only to `latest`; explicit branches/tags are unchanged.
Without a pattern, an untagged remote uses its default branch. No matching or
eligible tags returns an error. Prerelease detection recognizes SemVer tags with
an optional `v`; other tag names remain eligible.

The `t3code` recipe installs the official x86_64 Linux AppImage into
`~/.local/bin/t3code`:

```sh
lnxt install --git t3code
```
