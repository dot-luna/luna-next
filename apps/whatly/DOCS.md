# Whatly

`luna install whatly` builds the fork's default branch with CMake Release and
Ninja, including the recorded notification submodule. Dependencies include Qt
WebEngine, Wayland support, and Qt Linguist tools for translations. Git is supplied
by Luna's Git bootstrap app. No Luna theme or application settings are applied.

The native installation lives in `$LUNA_GIT_APP_INSTALL_DIR/whatly` (normally
`~/.local/share/luna/apps/git/whatly`). A launcher is installed at
`~/.local/bin/whatly`; upstream desktop entries, icons, application metadata, and
license are installed under `$XDG_DATA_HOME` (normally `~/.local/share`). Desktop
actions use the concrete launcher path, and installation refreshes the user
desktop database to register WhatsApp links. Existing Whatly profiles remain untouched.

Use `luna install whatly --force` to rebuild an unchanged revision or restore
missing installed files. Failed builds keep their workspace and logs without
publishing incomplete output. Publication replaces the owned native directory and
then individual desktop assets; a later filesystem failure can leave earlier
assets updated. Fix the error and rerun with `--force`.

Run the isolated recipe checks from the Luna checkout:

```sh
bun test __tests__/apps/whatly
```
