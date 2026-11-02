# luna

Bun CLI scaffold. Version and project information come from the selected
checkout's root `package.json`.

Build and run from the repository root:

```sh
bun run --cwd src/luna-cli build
LUNA_ROOT="$PWD" ./target/luna-bun
```

Use `luna -v` for the version, `luna --json` for the unchanged API response,
and `luna --help` for options. App actions are pending implementation.
