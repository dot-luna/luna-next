"""Exercise production Screensaver QML without touching the live desktop."""

import json
import re
import shutil
import subprocess
import time
import unittest

from _support import APP, Harness, QUICKSHELL, THEME


INSPECTOR = '''
    IpcHandler {
        target: "test"
        function state(): string {
            return JSON.stringify({configuration: shell.configuration, theme: shell.theme,
                showing: shell.showing, idleSeconds: shell.idleSeconds, idleEnabled: saverIdle.enabled,
                inhibitors: saverIdle.respectInhibitors, isIdle: saverIdle.isIdle,
                watchFiles: Quickshell.watchFiles, requestRunning: idleRequest.running,
                surfaces: surfaces.instances.map(surface => ({visible: surface.visible,
                    active: surface.keyboardActive, color: String(surface.color),
                    movementReady: surface.movementReady}))});
        }
        function idle(value: bool): void { if (saverIdle.enabled) saverIdle.isIdle = value; }
    }
'''


@unittest.skipUnless(QUICKSHELL, "Quickshell is required")
class ScreensaverTests(Harness, unittest.TestCase):
    def setUp(self):
        self.prepare()

    def start(self):
        self.append_shell(INSPECTOR)
        self.launch()

    def test_real_ipc_starts_hidden_and_reload_is_atomic(self):
        self.start()
        state = self.state()
        self.assertEqual(self.call("screensaver", "status"), "hidden")
        self.assertEqual(json.loads(self.call("screensaver", "snapshot")), {})
        self.assertEqual(state["idleSeconds"], 300)
        self.assertTrue(state["idleEnabled"])
        self.assertTrue(state["inhibitors"])
        self.assertFalse(state["watchFiles"])
        self.assertEqual(len(state["surfaces"]), 1)
        self.call("screensaver", "show")
        self.assertEqual(self.call("screensaver", "status"), "visible")
        self.assertTrue(self.state()["surfaces"][0]["visible"])
        self.assertTrue(self.state()["surfaces"][0]["active"])

        for settings, theme in (("not json", json.dumps(THEME)), ("{}", "not json"),
                                ("null", json.dumps(THEME)), ("{}", "null")):
            with self.subTest(settings=settings, theme=theme):
                result = self.call("screensaver", "reload", settings, theme)
                self.assertTrue(result.startswith("error:"), result + self.logs())
                self.assertEqual(self.state()["configuration"], {})
                self.assertEqual(self.state()["theme"], THEME)
                self.assertTrue(self.state()["showing"])

        next_theme = dict(THEME, colors=dict(THEME["colors"], background="#102030"))
        self.assertEqual(self.call("screensaver", "reload", '{"idle_seconds":0}', json.dumps(next_theme)), "ok")
        state = self.state()
        self.assertEqual(state["configuration"], {"idle_seconds": 0})
        self.assertEqual(state["theme"], next_theme)
        self.assertFalse(state["showing"])
        self.assertFalse(state["idleEnabled"])
        self.assertEqual(state["surfaces"][0]["color"], "#102030")
        self.call("screensaver", "show")
        self.call("screensaver", "hide")
        self.assertEqual(self.call("screensaver", "status"), "hidden")

    def test_idle_uses_api_command_and_resume_hides_and_rearms(self):
        self.start()
        self.call("test", "idle", "true")
        requests = self.root / "requests.jsonl"
        self.until(requests.exists)
        self.assertEqual(json.loads(requests.read_text()), self.command[1:] + ["show-idle"])
        # Only the API may decide to show after checking the compositor lock.
        self.assertEqual(self.call("screensaver", "status"), "hidden")
        self.call("screensaver", "show")
        self.call("test", "idle", "false")
        self.assertEqual(self.call("screensaver", "status"), "hidden")
        self.assertEqual(self.call("screensaver", "reload", '{"idle_seconds":1}', json.dumps(THEME)), "ok")
        self.assertEqual(self.state()["idleSeconds"], 1)
        self.assertFalse(self.state()["isIdle"])
        self.call("test", "idle", "true")
        self.until(lambda: len(requests.read_text().splitlines()) == 2)
        self.assertEqual(self.call("screensaver", "reload", '{"idle_seconds":0}', json.dumps(THEME)), "ok")
        self.assertFalse(self.state()["isIdle"])
        self.call("test", "idle", "true")
        time.sleep(0.1)
        self.assertEqual(len(requests.read_text().splitlines()), 2)

    def test_late_idle_request_cannot_reopen_after_activity_resumes(self):
        self.start()
        self.call("screensaver", "showIdle")
        self.assertEqual(self.call("screensaver", "status"), "hidden")
        self.call("test", "idle", "true")
        self.call("screensaver", "showIdle")
        self.assertEqual(self.call("screensaver", "status"), "visible")
        self.call("test", "idle", "false")
        self.call("screensaver", "showIdle")
        self.assertEqual(self.call("screensaver", "status"), "hidden")

    def test_malformed_or_missing_startup_snapshots_exit_with_diagnostic(self):
        for variable, value in (("LUNA_SCREENSAVER_SETTINGS", "not json"),
                                ("LUNA_SCREENSAVER_SETTINGS", ""),
                                ("LUNA_SCREENSAVER_THEME", "not json"),
                                ("LUNA_SCREENSAVER_THEME", ""),
                                ("LUNA_SCREENSAVER_THEME", "[]"),
                                ("LUNA_SCREENSAVER_COMMAND", "not json"),
                                ("LUNA_SCREENSAVER_COMMAND", "[]")):
            with self.subTest(variable=variable, value=value):
                env = dict(self.env, **{variable: value})
                result = subprocess.run([QUICKSHELL, "--no-color", "-p", str(self.renderer)],
                                        env=env, cwd=self.root, capture_output=True, text=True, timeout=10)
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("Luna screensaver startup:", result.stdout + result.stderr)

    def test_source_edits_do_not_reload_running_renderer(self):
        self.start()
        shell = self.renderer / "shell.qml"
        shell.write_text(shell.read_text() + "\n// Test edit must not replace the running renderer.\n")
        time.sleep(0.2)
        self.assertEqual(self.call("screensaver", "status"), "hidden")
        self.assertEqual(json.loads(self.call("screensaver", "snapshot")), {})
        self.assertNotIn("Reloading", self.logs())

    def test_production_surface_keyboard_pointer_clock_and_theme(self):
        # Run Qt Test in Quickshell so the real window and native imports remain
        # available. The disposable surface changes only layer-shell placement.
        shutil.copytree(APP / "tests/fixtures", self.root / "app/tests/fixtures")
        (self.root / "shell.qml").write_text('''import QtQuick
import QtQuick.Window
import Quickshell
import "app/tests/fixtures" as Tests
ShellRoot {
    Component.onCompleted: Quickshell.watchFiles = false
    Window {
        id: host
        width: 800
        height: 600
        visible: true
        Component.onCompleted: requestActivate()
        Tests.SaverSurfaceTests {
            anchors.fill: parent
            when: host.active
        }
    }
    Timer { interval: 15000; running: true; onTriggered: Qt.exit(98) }
}
''')
        result = subprocess.run([QUICKSHELL, "--no-color", "-p", str(self.root)],
                                env=self.env, cwd=self.root, capture_output=True, text=True, timeout=20)
        output = result.stdout + result.stderr
        self.assertEqual(result.returncode, 0, output)
        summary = re.search(r"LUNA_SCREENSAVER_TEST_RESULT (\{[^\n]+\})", output)
        self.assertIsNotNone(summary, output)
        counts = json.loads(summary.group(1))
        self.assertEqual(counts["failed"], 0, output)
        self.assertEqual(counts["skipped"], 0, output)
        expected = len(re.findall(r"function test_\w+\(", (APP / "tests/fixtures/SaverSurfaceTests.qml").read_text()))
        self.assertEqual(counts["passed"], expected + 1, output)
        for error in ("ReferenceError", "TypeError", "Binding loop", "Unable to assign"):
            self.assertNotIn(error, output)
