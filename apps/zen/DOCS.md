# Setup

`luna configure zen` applies the current Luna theme to the default existing profile
and installs the extensions in [settings.jsonc](config/settings.jsonc). Restart Zen
after configuration. To select another existing profile, close it and run:

```sh
bun apps/zen/scripts/setup-profile.ts --profile /absolute/path
```

Setup reads `luna theme get --json`. The standalone hook requires Luna, curl,
unzip and flock with `--fcntl` support. It selects the default from `~/.zen/profiles.ini`
or the XDG Zen directory. A missing default is skipped; ambiguous profiles and
active browser locks fail. Only `user.js`, `chrome/userChrome.css`,
`chrome/userContent.css` and declared extension XPIs are replaced, without backups.

# Appearance

Luna supplies paired background and text colors for the find bar, address bar,
menus, popups, tooltips, dialogs, notifications and built-in pages such as settings,
add-ons and downloads. Browser chrome uses square corners when Luna rounding is
zero. Websites keep their own colors, fonts and corner shapes.

Native file pickers follow GTK's theme. Extension-owned pages, operating-system
dialogs and developer tools can have their own styling. New Zen controls may need
updated selectors after browser upgrades. Rerun configuration after theme changes.

# Checks

```sh
bun test __tests__/apps/zen
```

Native style checks require `zen-browser` and Python 3. They use disposable headless
profiles to check dark/light controls, internal pages and unchanged website styling;
they do not modify the user's profile.
