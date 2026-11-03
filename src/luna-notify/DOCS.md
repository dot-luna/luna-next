# Luna Notify

Install with `luna install luna-notify`. Quickshell and busctl are installed as
app dependencies. Start from a Wayland session with a session D-Bus connection.
Another provider must release `org.freedesktop.Notifications` first; for Dunst,
use `systemctl --user mask --now dunst.service`. Luna reports a conflict instead
of stopping another provider. The supplied Hyprland configuration starts Luna
Notify at login.

`luna notify` shows status. `start` keeps a healthy instance; `stop` ends it;
`restart` validates current settings, then replaces it with a fresh theme/config snapshot. `focus` selects visible toasts
without starting a stopped provider; `dismiss` closes the newest toast.
Use `--install-dir PATH` for source QML instead of the installed
`$LUNA_CONFIG_HOME_DIR/notify` or XDG config's `luna/notify` directory.

Toasts appear at the top right of the focused monitor in a compact stack, with
the newest in front and three layers by default. Hovering over the stack
or focusing it with the keyboard expands the cards. Covered cards keep their
remaining timeout until exposed. Dismissing the front card reveals the next one.
A new arrival expires the oldest nonpersistent toast when full. Persistent
notifications are retained until dismissed or withdrawn by their sender; sticky
bursts may exceed the limit and remain accessible in the expanded stack. Replacements update
an existing toast and reset expiry when content changes. Identical replacements
retain the existing timer because Quickshell emits no update event for them.
Explicit sender timeouts are honored for every priority: positive milliseconds
auto-expire, and zero stays until dismissed. When unspecified, low and normal
priorities use `timeout_ms` (five seconds by default), and critical alerts stay. Hovering or
keyboard interaction pauses expiry. Expired and closed content is discarded;
there is no history, notification list, or persistence.

Toasts never take keyboard focus on arrival. Super+N (or `luna notify focus`)
focuses the newest toast. Tab/Shift+Tab select other toasts. Click, Enter, or Space
opens the notification through its default or explicit `open` action; otherwise,
Luna launches its visible desktop entry when available. Escape, Delete, or a
right-click dismisses the selected toast. No close or action buttons are shown;
other sender actions are not offered. Opening a toast releases keyboard focus
and closes it, including resident notifications. The last dismissal returns
keyboard focus to the previous application.

Bodies are plain text, limited to two lines. Notification images appear as 36 px
square avatars beside the message, falling back to the app icon, then a free Hugeicons
priority icon. Low priority is muted; critical titles and a 4 px left strip use
the theme error color. There are no large
image previews. Inline replies, markup, sounds, and Do Not Disturb are not included.

## Configuration

Settings are read once from `--config PATH`, then nonempty `LUNA_NOTIFY_CONFIG`,
otherwise `$LUNA_CONFIG_HOME_DIR/notify.jsonc`, `$XDG_CONFIG_HOME/luna/notify.jsonc`,
or `~/.config/luna/notify.jsonc`. Relative explicit paths use the working directory.
Missing files are created as `{}`; defaults merge only in memory. Existing comments
and omitted values remain untouched. Invalid settings do not stop a working provider.

```sh
luna notify get-config-file
luna notify get priority.low.opacity
# Edit notify.jsonc, then apply it explicitly:
luna notify restart
```

`get` without a key returns source settings; missing keys return `null`.
See the [default JSONC](../../apps/luna-notify/config/notify.jsonc) for timeout,
layout, stack, and priority options. Each priority also accepts `text_color`,
`title_color`, `strip_color`, `strip_width` (0–12 px), and `strip_side`
(`left` or `right`, default `left`). Colors accept `foreground`,
`bright_foreground`, `muted`, `accent`, `error`, or `#RRGGBB`. Fallback icons are
`information-circle`, `notification-02`, or `alert-02`; a valid sender image/icon
always takes precedence. `timeout_ms` accepts 250–60000 ms. `stack.limit` accepts
1–6 and limits nonpersistent overflow and collapsed layers; it never expires sticky
notifications. `stack.expand_on_hover: false` retains keyboard expansion through Super+N.

Theme and settings are snapshotted once at startup. There is no file watcher.
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
