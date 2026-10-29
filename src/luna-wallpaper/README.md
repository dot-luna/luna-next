# Luna Wallpaper

Quickshell wallpaper app for images, animations, and videos on the first monitor.

Copy [example.conf](example.conf) to `~/.config/luna-next/wallpaper.conf` and set
`wallpaper.source` to an absolute media path. From the repository root:

```sh
mise run install:hocon-qml
export QML_IMPORT_PATH="$HOME/.local/lib/qt6/qml${QML_IMPORT_PATH:+:$QML_IMPORT_PATH}"
quickshell -p src/luna-wallpaper/src/shell/shell.qml
```

Restart the app after config changes. See [DOCS.md](DOCS.md) for dependencies,
config paths, and tests.
