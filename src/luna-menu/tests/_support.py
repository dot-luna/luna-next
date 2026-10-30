"""Run menu UI checks with private XDG paths and harmless desktop entries."""

import json
import os
from pathlib import Path
import shutil


APP = Path(__file__).resolve().parents[1]
SHELL = APP / "src/shell"
QUICKSHELL = shutil.which("qs") or shutil.which("quickshell")
THEME = {
    "colors": {
        "background": "#e1e2e7", "foreground": "#343b58", "bright_foreground": "#1a1b26",
        "accent": "#34548a", "muted": "#b4b5bf", "selection": "#b7c1df",
        "selection_foreground": "#1a1b26", "lighter_background": "#f0f0f3",
    },
    "fonts": {"ui": "DejaVu Sans", "mono": "DejaVu Sans Mono"},
    "appearance": {"rounding": 13, "border_width": 2},
}


def isolated_environment(root):
    for name in ("runtime", "home", "config", "data", "system-data", "cache", "state", "bin"):
        (root / name).mkdir(mode=0o700)
    environment = dict(os.environ, HOME=str(root / "home"),
                       QT_QPA_PLATFORM="offscreen", QT_QUICK_BACKEND="software",
                       XDG_RUNTIME_DIR=str(root / "runtime"), XDG_CONFIG_HOME=str(root / "config"),
                       XDG_DATA_HOME=str(root / "data"), XDG_DATA_DIRS=str(root / "system-data"),
                       XDG_CACHE_HOME=str(root / "cache"), XDG_STATE_HOME=str(root / "state"),
                       PATH=f"{root / 'bin'}:/usr/bin:/bin", QS_NO_RELOAD_POPUP="1",
                       LUNA_NEXT_MENU_THEME=json.dumps(THEME),
                       DBUS_SYSTEM_BUS_ADDRESS="unix:path=/nonexistent-luna-next-menu-system-bus",
                       DBUS_SESSION_BUS_ADDRESS="unix:path=/nonexistent-luna-next-menu-session-bus")
    for name in ("WAYLAND_DISPLAY", "DISPLAY", "HYPRLAND_INSTANCE_SIGNATURE", "QML_IMPORT_PATH",
                 "QML2_IMPORT_PATH", "QT_LOGGING_RULES", "LUNA_NEXT_MENU_VALIDATE",
                 "LD_LIBRARY_PATH", "LD_PRELOAD"):
        environment.pop(name, None)
    return environment


def desktop_entries(root):
    """Both launch paths execute only recorders inside the temporary test directory."""
    binary = root / "bin/record-app"
    binary.write_text('''#!/usr/bin/python3
import json, os, pathlib, sys
with pathlib.Path(os.environ["MENU_LAUNCH_LOG"]).open("a") as output:
    output.write(json.dumps({"kind": pathlib.Path(sys.argv[0]).name, "args": sys.argv[1:], "cwd": os.getcwd()}) + "\\n")
''')
    binary.chmod(0o755)
    terminal = root / "bin/xdg-terminal-exec"
    shutil.copyfile(binary, terminal)
    terminal.chmod(0o755)
    folder = root / "data/applications"
    folder.mkdir()
    working = root / "working directory"
    working.mkdir()
    for entry_id, name, extra in (
        ("luna-test-editor", "Fixture Editor", ""),
        ("luna-test-terminal", "Fixture Terminal", "Terminal=true\n"),
        ("luna-test-hidden", "Hidden Fixture", "Hidden=true\n"),
        ("luna-test-nodisplay", "No Display Fixture", "NoDisplay=true\n"),
    ):
        (folder / f"{entry_id}.desktop").write_text(
            "[Desktop Entry]\nType=Application\n"
            f"Name={name}\nGenericName=Text Tool\nKeywords=fixture;writing;\n"
            f'Exec=record-app "literal argument; $HOME" %U\nPath={working}\n{extra}'
        )
