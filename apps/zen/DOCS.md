# Zen profile configuration

Luna installs the prebuilt AUR `zen-browser-bin` package and configures one
existing Zen profile. Run as your normal user and close Zen first.

```sh
luna install zen-browser-bin
luna conf zen
```

Package installation and full `luna setup` configure the default profile when
it exists. If none exists, they skip Zen configuration: open Zen once, close it,
then run `luna conf zen`. Luna never creates a Zen profile or opens its browser.

## Profile and exported files

The default comes from Zen's `profiles.ini`: an installation-specific default
takes precedence, followed by a profile marked default, then a sole profile.
Multiple candidates require an explicit selection:

```sh
luna conf zen --profile /path/to/existing/profile
```

Luna reads the existing `~/.zen` registry, otherwise `$XDG_CONFIG_HOME/zen`
(default `~/.config/zen`). `--profile` selects an exact profile
directory without requiring a registry. Missing profiles, ambiguous registries,
active browser locks, and symlinked profile/export paths return errors.

Configuration replaces these files without backups:

- `user.js`
- `chrome/userChrome.css` and `chrome/userContent.css`
- `extensions/uBlock0@raymondhill.net.xpi`
- `extensions/{446900e4-71c2-419f-a6a7-df9c091e268b}.xpi`

Browser data, other profiles, the profile registry, and global extension policies
remain unchanged. Existing add-ons, including Dark Reader, are not removed;
disabled add-ons are not reenabled.

## Appearance and extensions

Luna's selected theme supplies native browser colors and its UI font. Gecko's
generic serif/sans-serif defaults use the UI font; monospace defaults use the
theme's mono font. Websites retain their own declared fonts and colors.
When `appearance.rounding` is zero, browser UI and HTTP(S) page corners become
square. A positive value restores Zen's native rounding and website corner styles.

The default [settings.conf](config/settings.conf) includes signed Mozilla
packages for uBlock Origin and Bitwarden, excluding Dark Reader. Downloads and
package identities are checked before publication; Zen verifies signatures and
loads the extensions on its next start.

Restart Zen after configuring. Rerun `luna conf zen` after changing Luna's theme
or to refresh extension downloads; there are no configuration watchers.
Files publish atomically, but a late filesystem error can leave earlier files
updated. Resolve the reported error and rerun the command.

## Checks

```sh
cargo test -p luna-next
cargo test -p ln-cli
```

Tests use temporary profiles and fake commands; they do not modify live profiles
or install system packages.
