# Luna Notify

Install with `luna install luna-notify`. Quickshell and busctl are installed as
app dependencies. Start from a Wayland session with a session D-Bus connection.
Another provider must release `org.freedesktop.Notifications` first; for Dunst,
use `systemctl --user mask --now dunst.service`. Luna reports a conflict instead
of stopping another provider. The supplied Hyprland configuration starts Luna
Notify at login.

`luna notify` shows status. `start` keeps a healthy instance; `stop` ends it;
`restart` replaces it and reads the theme again. `focus` selects visible toasts
without starting a stopped provider; `dismiss` closes the newest toast.
Use `--install-dir PATH` for source QML instead of the installed
`$LUNA_CONFIG_HOME_DIR/notify` or XDG config's `luna/notify` directory.

Toasts appear at the top right of the focused monitor, with at most three live
notifications. A new arrival expires the oldest when full. Replacements update
an existing toast. Sender timeouts use milliseconds; the default is five seconds.
Critical alerts and timeout zero stay until dismissed or displaced. Hovering or
keyboard interaction pauses expiry. Expired and closed content is discarded;
there is no history, notification list, or persistence.

Toasts never take keyboard focus on arrival. Super+N (or `luna notify focus`)
focuses them: Tab/Shift+Tab navigate, Enter/Space activate, Delete dismisses the
focused toast, and Escape releases focus. The close button and app action buttons
support the mouse. Clicking the message invokes its explicit default action when
provided. Bodies are plain text. App icons and notification images are supported;
inline replies, markup, sounds, and Do Not Disturb are not included.

Theme settings are read once at startup, with no configuration file or watcher.
Configuration replaces the exported QML and restarts a running Luna provider;
a stopped provider stays stopped. Stop a source instance before starting the
installed copy, since both need the same D-Bus name.

From the repository root:

```sh
bun run check
bun test packages/luna-api/tests/notify.test.ts __tests__/apps/luna-notify __tests__/apps/hypr-startup.test.ts
/usr/bin/python3 -m unittest discover -s src/luna-notify/tests -v
/usr/lib/qt6/bin/qmllint --uncreatable-type disable src/luna-notify/src/shell/*.qml
bun run --cwd src/luna-cli build
```

Native tests require Python GObject (`python-gobject`) and Qt Test. They use a
private bus and offscreen windows; they do not contact the host provider or
verify compositor placement. The renderer uses QML directly and needs no native
build. To restore Dunst, stop Luna, remove its Hyprland startup command, and run
`systemctl --user unmask dunst.service` then `systemctl --user start dunst.service`.
