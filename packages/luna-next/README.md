# Luna Next API

Shared Rust operations for Luna's CLI, menu, and other applications.

```toml
[dependencies]
luna-next = { path = "packages/luna-next" }
serde_json = "1"
```

```rust
use luna_next::wallpaper::Wallpaper;
use serde_json::json;

fn main() -> luna_next::Result<()> {
    let wallpaper = Wallpaper::from_env()?;
    println!("{}", wallpaper.get_config(None)?);
    wallpaper.update_config(json!({"wallpaper": {"fit": "fit"}}))?;
    Ok(())
}
```

Config updates apply automatically. See [DOCS.md](DOCS.md) for APIs, paths,
dependencies, and tests.
