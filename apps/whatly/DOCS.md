# Whatly

`luna install whatly` builds the fork's default branch with CMake Release and
Ninja, including the recorded notification submodule. Dependencies include Qt
WebEngine, Wayland support, and Qt Linguist tools for translations. Git is supplied
by Luna's Git bootstrap app.

Installation and `luna configure whatly` apply Luna's current colors and fonts to
WhatsApp Web. Zero theme rounding squares message bubbles and controls. The hook
also sets the Linux Chrome 140 user-agent recorded in
[`config/whatly.conf`](config/whatly.conf). It uses native Whatly settings and custom
CSS; no browser extension or Whatly rebuild is needed for these defaults.

The default profile uses `$XDG_CONFIG_HOME/shakaran/whatly.conf` (normally
`~/.config/shakaran/whatly.conf`) and
`$XDG_DATA_HOME/shakaran/whatly/custom.css` (normally
`~/.local/share/shakaran/whatly/custom.css`). Configuration replaces the CSS and
updates only the declared appearance and user-agent keys. Accounts, shortcuts,
session storage, and named `--profile` configurations stay untouched. Existing
custom CSS is replaced without a backup. Close Whatly before running the hook
directly; the normal Luna command closes it automatically.

Rerun configuration after changing Luna's theme, then reopen Whatly. Light/dark
mode follows the resolved Luna theme at configuration time; Whatly's automatic
mode and color preset are disabled so they cannot override it. Native dialogs and
per-chat wallpapers can retain their own appearance. WhatsApp Web changes may
require updates to the CSS. Unsafe destinations and detected external edits stop
configuration; each file is published atomically, but a later failure can leave
the CSS updated before settings. Fix the error and rerun.

The native installation lives in `$LUNA_GIT_APP_INSTALL_DIR/whatly` (normally
`~/.local/share/luna/apps/git/whatly`). A launcher is installed at
`~/.local/bin/whatly`; upstream desktop entries, icons, application metadata, and
license are installed under `$XDG_DATA_HOME` (normally `~/.local/share`). Desktop
actions use the concrete launcher path, and installation refreshes the user
desktop database to register WhatsApp links.

Use `luna install whatly --force` to rebuild an unchanged revision or restore
missing installed files. Failed builds keep their workspace and logs without
publishing incomplete output. Publication replaces the owned native directory and
then individual desktop assets; a later filesystem failure can leave earlier
assets updated. Fix the error and rerun with `--force`.

Run the isolated recipe checks from the Luna checkout:

```sh
bun test __tests__/apps/whatly
```
