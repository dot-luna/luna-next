"""Exercise the real workspace controls without connecting to the user's compositor."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

APP = Path(__file__).resolve().parents[1]


class BarTests(unittest.TestCase):
    def test_keyboard_mouse_and_workspace_model(self):
        with tempfile.TemporaryDirectory(prefix="luna-bar-test-") as temporary:
            root = Path(temporary)
            (root / "bar").symlink_to(APP, target_is_directory=True)
            env = dict(os.environ, QT_QPA_PLATFORM="offscreen", QT_QUICK_BACKEND="software")
            for name in ("WAYLAND_DISPLAY", "DISPLAY", "HYPRLAND_INSTANCE_SIGNATURE", "QML_IMPORT_PATH", "QML2_IMPORT_PATH"):
                env.pop(name, None)
            for name in ("HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_RUNTIME_DIR"):
                directory = root / name
                directory.mkdir(mode=0o700)
                env[name] = str(directory)
            (root / "shell.qml").write_text('''import QtQuick
import QtQuick.Window
import Quickshell
import "bar/tests/fixtures" as Tests
ShellRoot {
    Component.onCompleted: Quickshell.watchFiles = false
    Window {
        id: window
        width: 400; height: 300; visible: true
        Component.onCompleted: requestActivate()
        Tests.WorkspaceTests { anchors.fill: parent; when: window.active }
    }
    Timer { interval: 10000; running: true; onTriggered: Qt.exit(98) }
}
''')
            result = subprocess.run(["dbus-run-session", "--", shutil.which("qs") or "quickshell", "--no-color", "-p", str(root)],
                                    env=env, capture_output=True, text=True, timeout=15)
            output = result.stdout + result.stderr
            self.assertEqual(result.returncode, 0, output)
            match = re.search(r"LUNA_BAR_TEST_RESULT (\{[^\n]+\})", output)
            self.assertIsNotNone(match, output)
            counts = json.loads(match.group(1))
            self.assertEqual(counts, {"passed": 8, "failed": 0, "skipped": 0}, output)
            for error in ("ReferenceError", "TypeError", "Binding loop", "Unable to assign"):
                self.assertNotIn(error, output)
