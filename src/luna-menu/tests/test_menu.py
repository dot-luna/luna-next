import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import tempfile
import time
import unittest

from _support import APP, QUICKSHELL, SHELL, THEME, desktop_entries, isolated_environment


@unittest.skipUnless(QUICKSHELL and shutil.which("dbus-run-session"),
                     "Quickshell and dbus-run-session are required")
class MenuTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="luna-next-menu ' ")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.env = isolated_environment(self.root)

    def run_shell(self, path, timeout=15):
        return subprocess.run(["dbus-run-session", "--", QUICKSHELL, "--no-color", "-p", str(path)],
                              env=self.env, cwd=self.root, capture_output=True, text=True, timeout=timeout)

    def offscreen_shell(self):
        directory = self.root / "window"
        shutil.copytree(SHELL, directory)
        path = directory / "MenuWindow.qml"
        # Offscreen Qt has no layer-shell protocol. Change only its window type and
        # compositor-only properties; keep dismissal, lifecycle, and real content.
        window = path.read_text().replace("PanelWindow {", "FloatingWindow {")
        window = window.replace("id: panel", "id: panel\n    implicitWidth: 800\n    implicitHeight: 700", 1)
        window = "\n".join(line for line in window.splitlines() if not line.strip().startswith(
            ("anchors { top: true;", "exclusionMode:", "WlrLayershell.")))
        path.write_text(window + "\n")
        return directory

    def test_real_shell_validates_hidden_ui_and_rejects_invalid_theme_input(self):
        self.env["LUNA_NEXT_MENU_VALIDATE"] = "1"
        shell = self.offscreen_shell()
        result = self.run_shell(shell)
        output = result.stdout + result.stderr
        self.assertEqual(result.returncode, 0, output)
        self.assertIn("Luna Next menu validation passed", output)
        for error in ("ReferenceError", "TypeError", "Binding loop", "Unable to assign"):
            self.assertNotIn(error, output)
        for theme in ("not json", "null", "{}", json.dumps(dict(THEME, fonts={})),
                      json.dumps(dict(THEME, appearance={"rounding": -1, "border_width": 1}))):
            with self.subTest(theme=theme):
                self.env["LUNA_NEXT_MENU_THEME"] = theme
                result = self.run_shell(shell)
                output = result.stdout + result.stderr
                self.assertNotEqual(result.returncode, 0, output)
                self.assertIn("Luna Next menu theme:", output)
                self.assertNotIn("Luna Next menu validation passed", output)

    def test_production_content_keyboard_mouse_search_and_native_desktop_entries(self):
        desktop_entries(self.root)
        self.env["MENU_LAUNCH_LOG"] = str(self.root / "launched.jsonl")
        (self.root / "menu").symlink_to(APP, target_is_directory=True)
        self.offscreen_shell()
        (self.root / "shell.qml").write_text('''import QtQuick
import QtQuick.Window
import Quickshell
import "menu/tests/fixtures" as Tests
import "window" as Menu

ShellRoot {
    Component.onCompleted: Quickshell.watchFiles = false
    Window {
        id: window
        width: 800
        height: 700
        visible: true
        Component.onCompleted: requestActivate()
        Tests.MenuContentTests {
            anchors.fill: parent
            when: window.active
            windowSource: Qt.resolvedUrl("window/MenuWindow.qml")
        }
    }
    Timer { interval: 20000; running: true; onTriggered: Qt.exit(98) }
}
''')
        result = self.run_shell(self.root, timeout=25)
        output = result.stdout + result.stderr
        self.assertEqual(result.returncode, 0, output)
        summary = re.search(r"LUNA_NEXT_MENU_TEST_RESULT (\{[^\n]+\})", output)
        self.assertIsNotNone(summary, output)
        counts = json.loads(summary.group(1))
        self.assertEqual(counts["failed"], 0, output)
        self.assertEqual(counts["skipped"], 0, output)
        fixture = APP / "tests/fixtures/MenuContentTests.qml"
        expected = len(re.findall(r"function test_\w+\(", fixture.read_text()))
        self.assertEqual(counts["passed"], expected + 1, output)
        for error in ("ReferenceError", "TypeError", "Binding loop", "Unable to assign"):
            self.assertNotIn(error, output)
        launches = [json.loads(line) for line in (self.root / "launched.jsonl").read_text().splitlines()]
        self.assertEqual(len(launches), 2)
        native = next(entry for entry in launches if entry["kind"] == "record-app")
        terminal = next(entry for entry in launches if entry["kind"] == "xdg-terminal-exec")
        self.assertEqual(native["args"], ["literal argument; $HOME"])
        self.assertEqual(terminal["args"], ["--", "record-app", "literal argument; $HOME"])
        self.assertEqual(native["cwd"], str(self.root / "working directory"))
        self.assertEqual(terminal["cwd"], native["cwd"])
        self.assertFalse((self.root / "UNEXPECTED").exists())

    def test_real_ipc_show_resets_root_and_hide_toggle_control_visibility(self):
        shell = self.offscreen_shell()
        path = shell / "shell.qml"
        source = path.read_text()
        # Inspect a private copy only; the production IPC surface stays limited.
        path.write_text(source.rstrip()[:-1] + '''
    IpcHandler {
        target: "test"
        function state(): string {
            return JSON.stringify({visible: shell.menuWindow.visible,
                apps: shell.menuWindow.content.appsView,
                query: shell.menuWindow.content.query});
        }
        function enterApps(): void { shell.menuWindow.content.activate(0); }
    }
}
''')

        def ipc(target, method):
            # `show` is also an IPC CLI subcommand. The terminator keeps it a method.
            return subprocess.run([QUICKSHELL, "ipc", "-p", str(shell), "call", "--", target, method],
                                  env=self.env, capture_output=True, text=True, timeout=3)

        def call(target, method):
            output = ipc(target, method)
            self.assertEqual(output.returncode, 0, output.stdout + output.stderr)
            return output.stdout.strip()

        def state():
            return json.loads(call("test", "state"))

        log_path = self.root / "ipc.log"
        with log_path.open("w") as log:
            process = subprocess.Popen(["dbus-run-session", "--", QUICKSHELL, "--no-color", "-p", str(shell)],
                                       env=self.env, cwd=self.root, stdout=log, stderr=subprocess.STDOUT,
                                       start_new_session=True)
            try:
                deadline = time.monotonic() + 5
                while True:
                    ready = ipc("menu", "status")
                    if ready.returncode == 0 and ready.stdout.strip() == "running":
                        break
                    if process.poll() is not None or time.monotonic() >= deadline:
                        self.fail("Menu did not become ready:\n" + log_path.read_text())
                    time.sleep(0.025)
                self.assertEqual(state(), {"visible": False, "apps": False, "query": ""})
                self.assertEqual(call("menu", "show"), "")
                self.assertTrue(state()["visible"])
                call("test", "enterApps")
                self.assertTrue(state()["apps"])
                call("menu", "show")
                self.assertEqual(state(), {"visible": True, "apps": False, "query": ""})
                call("menu", "hide")
                self.assertFalse(state()["visible"])
                call("menu", "toggle")
                self.assertTrue(state()["visible"])
                call("menu", "toggle")
                self.assertFalse(state()["visible"])
                self.assertEqual(call("menu", "status"), "running")
            finally:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=5)


if __name__ == "__main__":
    unittest.main()
