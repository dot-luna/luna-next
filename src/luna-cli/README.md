# luna

Luna CLI for project information, prerequisite installation, and CLI updates.

Build and run from the repository root:

```sh
bun run --cwd src/luna-cli build
LUNA_ROOT="$PWD" ./target/luna-bun
```

Use `luna -v` for the version, `luna self install` for setup, and
`luna self update --ref dev` to update the CLI.
See [DOCS.md](DOCS.md) for flags, setup limits, and checks.
