# GTK

Luna's GTK 4 styles. Windows request compositor blur, so translucent GTK apps such
as Files get Hyprland's theme blur like other apps.

The [app manifest](app.jsonc) exports `config/gtk.css` to
`$LUNA_CONFIG_HOME_DIR/gtk-4.0/` and imports it at the top of the user's
`gtk-4.0/gtk.css`, so personal rules override it.

```sh
luna configure gtk
```

Restart GTK apps to apply changes.
