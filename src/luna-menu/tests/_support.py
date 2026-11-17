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
        "accent": "#34548a", "accent_foreground": "#ffffff", "muted": "#b4b5bf", "selection": "#b7c1df",
        "selection_foreground": "#1a1b26", "lighter_background": "#f0f0f3",
    },
    "fonts": {"ui": "DejaVu Sans", "mono": "DejaVu Sans Mono"},
    "appearance": {"rounding": 13, "border_width": 2, "opacity": {"active": 0.9},
                   "gaps": {"outer": 8}, "blur": {"enabled": True, "size": 10, "passes": 3}},
}


def isolated_environment(root):
    for name in ("runtime", "home", "config", "data", "system-data", "cache", "state", "bin"):
        (root / name).mkdir(mode=0o700)
    # Never let UI tests reach the host's session or power commands.
    recorder = root / "bin/systemctl"
    recorder.write_text('''#!/usr/bin/python3
import json, os, pathlib, sys, time
if sys.argv[1:2] == ["emoji"]:
    with pathlib.Path(os.environ["MENU_CLIPBOARD_LOG"]).open("a") as output:
        output.write(json.dumps(sys.argv[1:]) + "\\n")
    if sys.argv[2] == "list":
        data = [{"name": "grinning face", "emoji": "😀", "keywords": "smile happy"},
                {"name": "red heart", "emoji": "❤️", "keywords": "love"}]
        data += [{"name": "face " + str(i), "emoji": "😎", "keywords": "face"} for i in range(10)]
    else: data = {"text": "".join(sys.argv[3:sys.argv.index("--target")])}
    print(json.dumps({"succes": True, "data": data}))
    sys.exit(0)
if sys.argv[1:2] == ["clipboard"]:
    with pathlib.Path(os.environ["MENU_CLIPBOARD_LOG"]).open("a") as output:
        output.write(json.dumps(sys.argv[1:]) + "\\n")
    action = sys.argv[2]
    if action == "list":
        data = [{"id": "1", "name": "Alpha text"}, {"id": "2", "name": "[PNG] Image", "attachment": True}]
    elif action == "preview":
        entry_id = sys.argv[3]
        if entry_id == "1": time.sleep(0.08)
        data = {"id": entry_id, "name": "[PNG] 70 bytes" if entry_id == "2" else "Alpha text", "text": "Alpha\\nfull text" if entry_id == "1" else "", "mime": "text/plain" if entry_id == "1" else "image/png",
                "image": "" if entry_id == "1" else "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=="}
    else: data = {"id": sys.argv[3]}
    print(json.dumps({"succes": True, "data": data}))
    sys.exit(0)
with pathlib.Path(os.environ["MENU_SESSION_LOG"]).open("a") as output:
    output.write(json.dumps({"command": pathlib.Path(sys.argv[0]).name, "args": sys.argv[1:]}) + "\\n")
if os.environ.get("MENU_SESSION_FAIL") == "1":
    print("fixture denied request", file=sys.stderr)
    sys.exit(7)
''')
    recorder.chmod(0o755)
    shutil.copyfile(recorder, root / "bin/hyprctl")
    (root / "bin/hyprctl").chmod(0o755)
    launcher = root / "home/.local/bin/luna"
    launcher.parent.mkdir(parents=True)
    shutil.copyfile(recorder, launcher)
    launcher.chmod(0o755)
    environment = dict(os.environ, MENU_SESSION_LOG=str(root / "session.jsonl"), MENU_CLIPBOARD_LOG=str(root / "clipboard.jsonl"), HOME=str(root / "home"),
                       QT_QPA_PLATFORM="offscreen", QT_QUICK_BACKEND="software", GIO_USE_VFS="local",
                       XDG_RUNTIME_DIR=str(root / "runtime"), XDG_CONFIG_HOME=str(root / "config"),
                       XDG_DATA_HOME=str(root / "data"), XDG_DATA_DIRS=str(root / "system-data"),
                       XDG_CACHE_HOME=str(root / "cache"), XDG_STATE_HOME=str(root / "state"),
                       PATH=f"{root / 'bin'}:/usr/bin:/bin", QS_NO_RELOAD_POPUP="1",
                       LUNA_MENU_THEME=json.dumps(THEME),
                       DBUS_SYSTEM_BUS_ADDRESS="unix:path=/nonexistent-luna-menu-system-bus",
                       DBUS_SESSION_BUS_ADDRESS="unix:path=/nonexistent-luna-menu-session-bus")
    for name in ("WAYLAND_DISPLAY", "DISPLAY", "HYPRLAND_INSTANCE_SIGNATURE", "QML_IMPORT_PATH",
                 "QML2_IMPORT_PATH", "QT_LOGGING_RULES", "LUNA_MENU_VALIDATE",
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
    browser = root / "bin/xdg-open"
    shutil.copyfile(binary, browser)
    browser.chmod(0o755)
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
