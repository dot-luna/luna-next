"""Isolate Qt processes from the user's configuration, shell and D-Bus buses."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


APP = Path(__file__).resolve().parents[1]
REPO = APP.parents[1]
SHELL = APP / "src/shell"
QUICKSHELL = shutil.which("qs") or shutil.which("quickshell")
THEME = {
    "fonts": {"ui": "Sans", "mono": "Monospace"},
    "colors": {
        "accent": "#7aa2f7", "accent_foreground": "#1a1b26",
        "background": "#1a1b26", "foreground": "#a9b1d6",
        "bright_foreground": "#c0caf5", "dark_background": "#13141c",
        "darker_background": "#0e0e14", "dark_foreground": "#565f89",
        "light_foreground": "#b4bee6", "lighter_background": "#24283b",
        "muted": "#414868", "selection": "#292e42",
        "selection_foreground": "#c0caf5", "error": "#f7768e",
        "error_emphasis": "#ff7a93", "error_foreground": "#1a1b26",
        "info": "#449dab", "info_emphasis": "#0db9d7", "info_foreground": "#1a1b26",
        "success": "#9ece6a", "success_emphasis": "#b9f27c", "success_foreground": "#1a1b26",
        "warning": "#e0af68", "warning_emphasis": "#ff9e64", "warning_foreground": "#1a1b26",
        "notice": "#eb927b", "notice_foreground": "#1a1b26", "comment": "#bd8b7b",
        "link": "#7aa2f7", "link_emphasis": "#7da6ff",
        "secondary_accent": "#ad8ee6", "secondary_accent_emphasis": "#bb9af7",
        "secondary_accent_foreground": "#1a1b26", "mode": "dark",
    },
    "appearance": {
        "rounding": 0, "border_width": 1, "gaps": {"inner": 5, "outer": 5},
        "opacity": {"active": 0.9, "inactive": 0.85, "fullscreen": 1},
        "blur": {"enabled": True, "passes": 3, "size": 10},
        "shadow": {"enabled": True, "range": 12, "falloff": 3},
    },
    "wallpaper": {"sources": []},
}


def isolated_environment(root):
    for name in ("runtime", "home", "config", "cache", "state", "data"):
        (root / name).mkdir(mode=0o700)
    environment = dict(os.environ, HOME=str(root / "home"),
                       QT_QPA_PLATFORM="offscreen", QT_QUICK_BACKEND="software",
                       XDG_RUNTIME_DIR=str(root / "runtime"),
                       XDG_CONFIG_HOME=str(root / "config"),
                       XDG_CACHE_HOME=str(root / "cache"),
                       XDG_DATA_HOME=str(root / "data"),
                       XDG_STATE_HOME=str(root / "state"),
                       LUNA_NEXT_POLKIT_THEME=json.dumps(THEME), QS_NO_RELOAD_POPUP="1",
                       DBUS_SYSTEM_BUS_ADDRESS="unix:path=/nonexistent-luna-next-polkit-system-bus",
                       DBUS_SESSION_BUS_ADDRESS="unix:path=/nonexistent-luna-next-polkit-session-bus")
    for name in ("WAYLAND_DISPLAY", "DISPLAY", "HYPRLAND_INSTANCE_SIGNATURE", "QML_IMPORT_PATH",
                 "QML2_IMPORT_PATH", "QT_LOGGING_RULES", "LUNA_NEXT_POLKIT_VALIDATE"):
        environment.pop(name, None)
    return environment


def system_python():
    """Use system GI packages even when discovery runs from a Python environment."""
    for executable in dict.fromkeys((sys.executable, "/usr/bin/python3", "/usr/bin/python")):
        if not Path(executable).is_file():
            continue
        probe = subprocess.run(
            [executable, "-c", "import gi; gi.require_version('Polkit', '1.0'); "
             "from gi.repository import Gio, GLib, Polkit"],
            capture_output=True, timeout=5,
        )
        if probe.returncode == 0:
            return executable
    return None
