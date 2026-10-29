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
| `version` | Optional mise version or Git branch/tag. Git `latest` selects the highest version tag. Omitted/`null`, or `latest` without tags, uses Git's default branch. |
| `url` | Repository URL for `git`, a source path for `local`, or `null` for other sources. |
| `purpose` | A short explanation of why the package is included. |
| `destination` | Optional local link path relative to `~/.local`; defaults to `src/<name>`. |
| `command` | Argument arrays run in the Git checkout or local source directory. Empty for a local package needing only a link. |

`packages.git.conf`, `packages.mise.conf`, and `packages.local.conf` contain bare
arrays. Local `url` paths resolve from this checkout. Keep build/install steps in
the project and call its task, for example `[["mise", "run", "install:hocon-qml"]]`.
