# Development

`greeter/` handles SDDM interaction and login logic. `screens/` handles the UI.
SDDM authenticates users and starts Hyprland; the greeter uses the native session
or its UWSM entry, with no fallback to another desktop.

Ctrl+Alt+F6 switches to systemd's default reserved login console.
