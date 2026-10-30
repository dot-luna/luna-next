# Chromium profiles

Luna uses Arch's prebuilt AUR `ungoogled-chromium-bin` package. It provides the
normal `chromium` executable and replaces conflicting Chromium/chromedriver
packages through the package manager. Existing browser data is retained.

## Commands

```sh
luna install ungoogled-chromium-bin
luna chromium create-profile
luna conf chromium
```

The last command opens an installation page in the selected profile. Click its
extension/theme links and approve Chromium's native confirmations. Preparation
does not mean the items are installed: Chromium completes each installation
after you approve it.

| Command | Behavior |
| --- | --- |
| `luna chromium create-profile [--profile PATH]` | Create a missing profile using global Git `user.name`, without extensions or theme changes. Reuse an existing profile without resetting it. |
| `luna conf chromium [--profile PATH]` | Prepare settings for an existing profile and open its installation page. A missing profile requires `create-profile` first. `configure` is the full command name. |
| `luna chromium setup [--profile PATH] [--repo PATH]` | Create the selected profile if missing, prepare settings, and open its installation page. |

Without `--profile`, commands select the stable Git-created profile under
`$XDG_CONFIG_HOME/luna-next/chromium/Default`. Its initial display name comes
from `git config --global --get user.name`; its directory does not depend on that
name. The launcher is `~/.local/bin/luna-chromium`, also listed as
**Chromium (Luna)** in the application menu. Creating this profile leaves the
regular Chromium `Default` profile and desktop browser choice intact.

An override is an exact **profile directory**, not the parent user-data directory
or a display name. For example:

```sh
luna conf chromium --profile "$HOME/.config/chromium/Profile 1"
```

Close all Chromium windows using that user-data directory first. Luna refuses
active or stale singleton markers and never removes them or stops the browser.
Profile creation and configuration reject symlinked destinations. Existing
bookmarks, cookies, history, passwords, names, and unrelated preferences remain
in place; other profiles receive no settings, extensions, or styles.

Package installs and all-app configuration prepare an already-created default
profile without opening a browser. They skip a missing profile; run
`luna chromium setup` to create it and finish the confirmations.

## Extensions and appearance

The [app settings](config/settings.conf) select these exact Web Store listings:

- [uBlock](https://chromewebstore.google.com/detail/ublock/epcnnfbjfcgphgdmggkamkmgojdagdnn)
- [SponsorBlock for YouTube](https://chromewebstore.google.com/detail/sponsorblock-for-youtube/mnjggcdmjocbbbhaepdhchncahnbgone)
- [YouTube Custom Speed](https://chromewebstore.google.com/detail/youtube-custom-speed/kmfcinojnfabkpndlgomnfjllgeppegb)
- [Adblock for YouTube](https://chromewebstore.google.com/detail/adblock-for-youtube/cmedhionkhpnakcndndgjdbohmhepckk)

Luna also prepares a browser color theme and a website appearance extension from
the selected Luna theme. Website corners are square; body text and form controls
use `fonts.ui`, while code and preformatted text use `fonts.mono`. Chromium's
default standard/sans/serif web fonts and fixed-width font use those same roles.
Install the selected font families locally.

Native browser colors use the theme palette. Chromium themes cannot set the
native toolbar/menu font or square native tabs and address bars. Website styles
do not affect protected browser pages or content inside shadow roots; sites with
explicit font families may retain those fonts.

Rerun configuration after changing the Luna theme or to fetch current extension
packages, then finish any installation/update confirmations. There are no
watchers. Ungoogled Chromium disables the usual Web Store update flow; Luna does
not add a background updater.

Generated packages, local appearance signing keys, and the installation page
live in the selected profile's `Luna Next` folder. Reconfiguration replaces
that generated folder, reuses its signing keys, and preserves the browser data
around it. Do not remove those keys if you want to update the same local theme
and website extension identities.

Luna validates settings and downloaded package metadata before publication;
Chromium verifies package signatures during installation. Files publish
atomically; a late filesystem/launch failure can leave prepared settings in
place. Retry the command after resolving the reported error.

## Checks

```sh
cargo test -p luna-next
cargo test -p ln-cli
```

Tests use temporary profiles and fake package/browser commands. They never
replace the installed browser or modify the user's live profiles.
