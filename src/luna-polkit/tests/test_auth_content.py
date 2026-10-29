"""Exercise production prompt controls with fake flows and actual keyboard events."""

import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

from _support import QUICKSHELL, REPO, SHELL, isolated_environment


@unittest.skipUnless(QUICKSHELL and shutil.which("dbus-run-session"),
                     "Quickshell and dbus-run-session required")
class AuthenticationContentTests(unittest.TestCase):
    def test_authentication_content(self):
        with tempfile.TemporaryDirectory(prefix="luna-next-polkit-ui-") as directory:
            root = Path(directory)
            environment = isolated_environment(root)
            (root / "repo").symlink_to(REPO, target_is_directory=True)
            dialog = root / "dialog"
            shutil.copytree(SHELL, dialog)
            # Offscreen Qt has no layer-shell surface. Keep production scrolling
            # and controls, replacing only the compositor-specific window shell.
            window = (dialog / "AuthDialog.qml").read_text()
            window = window.replace("import QtQuick\n", "import QtQuick\nimport QtQuick.Window\n")
            window = window.replace("PanelWindow {", "Window {")
            window = "\n".join(line for line in window.splitlines()
                               if not line.strip().startswith(("anchors { top: true;", "exclusionMode:",
                                                               "WlrLayershell.")))
            (dialog / "AuthDialog.qml").write_text(window + "\n")
            (root / "shell.qml").write_text('''import QtQuick
import QtQuick.Window
import Quickshell
import "repo/src/luna-polkit/tests/fixtures" as Tests
// Quickshell scans this directory before the test loads its dialog dynamically.
import "dialog" as Dialog

ShellRoot {
    Component.onCompleted: Quickshell.watchFiles = false

    Window {
        id: testWindow
        width: 640
        height: 700
        visible: true
        Component.onCompleted: requestActivate()

        Tests.AuthContentTests {
            anchors.fill: parent
            when: testWindow.active
            dialogSource: Qt.resolvedUrl("dialog/AuthDialog.qml")
        }
    }

    Timer {
        interval: 20000
        running: true
        onTriggered: Qt.exit(98)
    }
}
''')
            # UI-only fixtures instantiate no native agent; the system address
            # stays invalid while dbus-run-session supplies a private session bus.
            result = subprocess.run(["dbus-run-session", "--", QUICKSHELL, "--no-color", "-p", str(root)],
                                    env=environment, capture_output=True, text=True, timeout=25)
            output = result.stdout + result.stderr
            self.assertEqual(result.returncode, 0, output)
            summary = re.search(r"LUNA_NEXT_POLKIT_TEST_RESULT (\{[^\n]+\})", output)
            self.assertIsNotNone(summary, output)
            counts = json.loads(summary.group(1))
            self.assertEqual(counts["failed"], 0, output)
            self.assertEqual(counts["skipped"], 0, output)
            fixture = Path(__file__).parent / "fixtures/AuthContentTests.qml"
            expected = len(re.findall(r"function test_\w+\(", fixture.read_text()))
            self.assertEqual(counts["passed"], expected + 1, output)
            for error in ("ReferenceError", "TypeError", "Binding loop", "Unable to assign"):
                self.assertNotIn(error, output)


if __name__ == "__main__":
    unittest.main()
