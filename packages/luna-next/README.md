# Luna Next API

Shared Rust operations for Luna's CLI, menu, and other applications.

```toml
[dependencies]
luna-next = { path = "packages/luna-next" }
```

```rust
use luna_next::wallpaper::Wallpaper;

fn main() -> luna_next::Result<()> {
    let wallpaper = Wallpaper::from_env()?;
    println!("{}", wallpaper.get_config(None)?);
    Ok(())
}
```

Config updates apply automatically. See [DOCS.md](DOCS.md) for APIs, paths,
dependencies, and tests.
