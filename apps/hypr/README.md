# Hyprland

Luna's Hyprland Lua defaults: monitors, workspaces, input, theme, animations,
shortcuts, and session startup. The KDE Polkit agent supplies desktop authentication
prompts; Luna Menu starts hidden at login. Luna’s wallpaper renderer and custom
authentication agent are not part of the current JSONC app catalog.

The [app manifest](app.jsonc) exports `config/` to `$LUNA_CONFIG_HOME_DIR/hypr/`
and includes Luna's entry in the user's Hyprland configuration before personal overrides.

Colors, gaps, borders, rounding, opacity, blur, and shadows come from
`luna theme hyprland` on startup/reload, including Luna's defaults when no theme is
selected. The transparency shortcut uses the resolved opacity values. Luna Menu
controls its own blur toggle and uses Hyprland's theme blur strength.
Theme resolution errors stop configuration loading.

[config/env.lua](config/env.lua) defines standard XDG homes and `LUNA_*` paths for
the repository, configurations, data, cache, state, local apps, and Git app clones/builds/installs.
Inherited path overrides take precedence. `LUNA_THEME_NAME` and `LUNA_THEME_DIR`
refresh from Luna's CLI on reload; the directory is empty for built-in defaults.
Lua files can read these with `os.getenv`, and launched apps inherit them.
`QML_IMPORT_PATH` includes `~/.local/lib/qt6/qml`, preserving existing import paths
without adding duplicates on configuration reload.

App integrations such as Bitwarden, btop, and Fastfetch register their fragments
in `$LUNA_CONFIG_HOME_DIR/hypr/include.lua`, which starts empty and loads after
the core defaults. Apply app integrations after exporting Hyprland's directory.

After configuring, reload the desktop to apply changes:

```sh
hyprctl reload
```
