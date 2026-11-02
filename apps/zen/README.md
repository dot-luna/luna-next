# Zen Browser

Luna's theme, fonts, uBlock Origin, and Bitwarden for an existing Zen profile.
Square browser and website corners apply only when Luna's theme rounding is zero.

```sh
# Open Zen once to create a profile, then close it.
bun apps/zen/scripts/setup-profile.ts
```

The [manifest](app.jsonc) declares this hook for `after_configure`. It reads
[settings.jsonc](config/settings.jsonc) and `luna theme get --json`; system Bun,
Luna, curl, unzip, and flock with `--fcntl` support must be available.

The hook selects the default profile from `~/.zen/profiles.ini` or the XDG Zen
directory. Use `--profile /absolute/path` to select another existing profile.
A missing default is skipped; ambiguous profiles and active browser locks fail.
Only `user.js`, the two `chrome/user*.css` files, and declared extension XPIs are
replaced without backups. Restart Zen afterward.
