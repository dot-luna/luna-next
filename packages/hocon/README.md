# luna-next-hocon

Rust helper for Luna's HOCON configuration. Read and edit values by path,
resolve includes and substitutions, and export JSON.

```toml
[dependencies]
luna-next-hocon = { path = "packages/hocon" }
serde_json = "1"
```

```rust
use luna_next_hocon::Config;
use serde_json::json;

fn configure() -> luna_next_hocon::Result<()> {
    let mut config = Config::open("config.conf")?;

    config.set("wallpaper.duration", json!(600))?;
    let duration = config.get("wallpaper.duration")?;
    let resolved = config.resolved()?;
    let json = config.to_json()?;
    config.unset("wallpaper.duration")?;

    Ok(())
}
```

Opening creates missing files and parent directories. Missing keys return JSON null.

See [DOCS.md](DOCS.md) for API details, file behavior, limitations, and tests.
For Quickshell, use the [QML adapter](../hocon-qml/README.md).
