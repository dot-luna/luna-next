"""Exercise the production lock controller without locking a real desktop."""

import json
import re
import shutil
import subprocess
import time
import unittest

from _support import APP, Harness, QUICKSHELL, SHELL, THEME


INSPECTOR = '''
    IpcHandler {
        target: "test"
        function state(): string {
            return JSON.stringify({configuration: shell.configuration, theme: shell.theme,
                idleSeconds: shell.idleSeconds, dpmsSeconds: shell.dpmsSeconds,
                idleEnabled: autoLockIdle.enabled, idleInhibitors: autoLockIdle.respectInhibitors,
                displayEnabled: displayIdle.enabled, displayInhibitors: displayIdle.respectInhibitors,
                displayIdle: displayIdle.isIdle, watchFiles: Quickshell.watchFiles,
                secure: sessionLock.secure, requested: shell.lockRequested,
                unlockCalls: sessionLock.unlockCalls, stopping: shell.stopping,
                powerDesired: displayPower.desired, powerBusy: displayPower.busy,
                powerAttempt: displayPower.lastAttempt, authActive: authContext.active,
                authPending: authContext.conversationPending, authConfig: authContext.config,
                authResponses: authContext.responseLengths, authStarts: authContext.startCalls,
                responseRequired: authContext.responseRequired, authStatus: authContext.statusText,
                surface: sessionLock.instance ? {color: String(sessionLock.instance.color),
                    active: sessionLock.instance.keyboardActive} : null});
        }
        function idle(value: bool): void { if (autoLockIdle.enabled) autoLockIdle.isIdle = value; }
        function displayIdle(value: bool): void { if (displayIdle.enabled) displayIdle.isIdle = value; }
        function activity(): void { displayPower.setOff(false); }
        function autoSecure(value: bool): void { sessionLock.autoSecure = value; }
        function secure(): void { sessionLock.secure = true; }
        function complete(result: int): void { authContext.finish(result); }
        function authenticationError(): void { authContext.fail(); }
        function submit(): void { authContext.submit("dummy response"); }
        function startSucceeds(value: bool): void { authContext.startSucceeds = value; }
        function retry(): void { authContext.begin(); }
    }
'''


@unittest.skipUnless(QUICKSHELL, "Quickshell is required")
class LockTests(Harness, unittest.TestCase):
    def setUp(self):
        self.prepare()

    def start(self):
        self.append_shell(INSPECTOR)
        self.launch()

    def lock(self):
        self.assertEqual(self.call("lock", "lock"), "ok")
        self.assertEqual(self.call("lock", "status"), "locked")
        self.assertTrue(self.state()["secure"])

    def test_native_interfaces_compile_and_start_idle_without_a_compositor(self):
        # Native types are instantiated but never asked to acquire a lock or
        # start PAM. This checks their real QML API independently of mocks.
        shutil.rmtree(self.renderer)
        shutil.copytree(SHELL, self.renderer)
        self.launch()
        self.assertEqual(self.call("lock", "status"), "idle")
        self.assertEqual(self.call("lock", "stop"), "ok")
        self.process.wait(timeout=5)
        self.assertEqual(self.process.returncode, 0, self.logs())

    def test_lock_acquisition_stop_refusal_and_atomic_reload(self):
        self.start()
        state = self.state()
        self.assertEqual(state["idleSeconds"], 600)
        self.assertEqual(state["dpmsSeconds"], 30)
        self.assertTrue(state["idleEnabled"])
        self.assertTrue(state["idleInhibitors"])
        self.assertFalse(state["displayEnabled"])
        self.assertFalse(state["displayInhibitors"])
        self.assertFalse(state["watchFiles"])
        self.call("test", "autoSecure", "false")
        self.assertEqual(self.call("lock", "lock"), "ok")
        self.assertEqual(self.call("lock", "status"), "locking")
        self.assertEqual(self.call("lock", "stop"), "refused")
        self.assertFalse(self.state()["stopping"])
        self.assertFalse(self.state()["authActive"])
        self.call("test", "secure")
        self.assertEqual(self.call("lock", "status"), "locked")
        self.assertEqual(self.call("lock", "stop"), "refused")
        self.assertTrue(self.state()["displayEnabled"])
        self.assertEqual(self.state()["authConfig"], "login")
        self.assertTrue(self.state()["responseRequired"])
        self.assertEqual(self.state()["surface"]["color"], THEME["colors"]["background"])

        for settings, theme in (("not json", json.dumps(THEME)), ("{}", "null")):
            self.assertTrue(self.call("lock", "reload", settings, theme).startswith("error:"))
            self.assertEqual(self.state()["configuration"], {})
            self.assertEqual(self.state()["theme"], THEME)
            self.assertEqual(self.call("lock", "status"), "locked")
        next_theme = dict(THEME, colors=dict(THEME["colors"], background="#102030"))
        self.assertEqual(self.call("lock", "reload", '{"idle_seconds":0,"dpms_seconds":0}',
                                   json.dumps(next_theme)), "ok")
        state = self.state()
        self.assertEqual(state["surface"]["color"], "#102030")
        self.assertFalse(state["displayEnabled"])
        self.assertFalse(state["idleEnabled"])
        self.assertEqual(self.call("lock", "status"), "locked")
        self.assertEqual(state["unlockCalls"], 0)
        self.assertTrue(state["responseRequired"])

    def test_only_successful_current_pam_conversation_can_unlock(self):
        self.start()
        self.call("test", "complete", "0")
        self.assertEqual(self.state()["unlockCalls"], 0)
        self.lock()
        self.assertNotEqual(self.ipc("lock", "unlock", check=False).stdout.strip(), "ok")
        self.assertEqual(self.call("lock", "status"), "locked")
        self.call("test", "submit")
        self.assertEqual(self.state()["authResponses"], [14])
        self.call("lock", "reload", "{}", json.dumps(THEME))
        self.assertTrue(self.state()["authActive"])
        self.assertTrue(self.state()["authPending"])
        self.assertFalse(self.state()["responseRequired"])
        self.assertNotIn("dummy response", self.logs())
        for result in (1, 3):
            self.call("test", "complete", str(result))
            self.until(lambda: self.state()["responseRequired"])
            self.assertEqual(self.call("lock", "status"), "locked")
            self.assertEqual(self.state()["unlockCalls"], 0)
            self.assertEqual(self.state()["authStatus"], "Try again")
        self.call("test", "complete", "2")
        self.assertEqual(self.call("lock", "status"), "locked")
        self.assertEqual(self.state()["authStatus"], "Authentication unavailable")
        self.assertFalse(self.state()["authPending"])
        self.call("test", "complete", "0")
        self.assertEqual(self.call("lock", "status"), "locked")
        self.assertEqual(self.state()["unlockCalls"], 0)
        # Retry starts a new native conversation; only its Success releases it.
        self.call("test", "retry")
        self.assertTrue(self.state()["responseRequired"])
        self.call("test", "authenticationError")
        self.assertEqual(self.call("lock", "status"), "locked")
        self.assertEqual(self.state()["unlockCalls"], 0)
        self.call("test", "complete", "0")
        self.assertEqual(self.call("lock", "status"), "locked")
        self.call("test", "retry")
        self.call("test", "complete", "0")
        self.assertEqual(self.call("lock", "status"), "idle")

    def test_failed_pam_start_keeps_lock_and_allows_retry(self):
        self.start()
        self.call("test", "startSucceeds", "false")
        self.lock()
        self.assertFalse(self.state()["authPending"])
        self.assertFalse(self.state()["responseRequired"])
        self.assertEqual(self.state()["authStatus"], "Authentication unavailable")
        self.assertEqual(self.state()["unlockCalls"], 0)
        self.call("test", "startSucceeds", "true")
        self.call("test", "retry")
        self.assertTrue(self.state()["responseRequired"])
        self.call("test", "complete", "0")
        self.assertEqual(self.call("lock", "status"), "idle")

    def test_success_unlocks_and_rearms_auto_lock(self):
        self.start()
        self.lock()
        self.call("test", "complete", "0")
        self.assertEqual(self.call("lock", "status"), "idle")
        state = self.state()
        self.assertEqual(state["unlockCalls"], 1)
        self.assertFalse(state["authActive"])
        self.assertFalse(state["authPending"])
        self.assertTrue(state["idleEnabled"])
        self.assertFalse(state["displayEnabled"])
        self.assertIsNone(state["surface"])
        self.call("lock", "reload", '{"idle_seconds":0}', json.dumps(THEME))
        self.assertFalse(self.state()["idleEnabled"])
        self.call("test", "idle", "true")
        self.call("lock", "lockIdle")
        self.assertEqual(self.call("lock", "status"), "idle")

    def test_idle_requests_use_api_and_stale_idle_cannot_lock(self):
        self.start()
        self.assertEqual(self.call("lock", "lockIdle"), "ok")
        self.assertEqual(self.call("lock", "status"), "idle")
        self.call("test", "idle", "true")
        self.until(lambda: len(self.requests()) >= 2)
        self.assertEqual(self.requests()[0]["arguments"], self.command[1:] + ["lock-idle"])
        self.assertEqual(self.call("lock", "status"), "idle")
        self.call("test", "idle", "false")
        self.call("lock", "lockIdle")
        self.assertEqual(self.call("lock", "status"), "idle")
        self.call("test", "idle", "true")
        self.call("lock", "lockIdle")
        self.assertEqual(self.call("lock", "status"), "locked")

    def test_display_idle_ignores_inhibitors_and_wake_waits_for_inflight_off(self):
        self.start()
        self.assertEqual(self.call("lock", "canPowerOff"), "false")
        self.lock()
        (self.root / "block-off").touch()
        self.call("test", "displayIdle", "true")
        self.assertEqual(self.call("lock", "canPowerOff"), "true")
        self.until(lambda: len(self.requests()) == 1)
        self.assertEqual(self.requests()[0], {"event": "start",
                                            "arguments": self.command[1:] + ["display", "off"]})
        self.assertFalse(self.state()["displayInhibitors"])
        self.call("test", "displayIdle", "false")
        self.assertEqual(self.call("lock", "canPowerOff"), "false")
        self.assertEqual(self.state()["powerDesired"], "on")
        self.assertTrue(self.state()["powerBusy"])
        self.assertEqual(len(self.requests()), 1)
        (self.root / "release-off").touch()
        self.until(lambda: len(self.requests()) == 4)
        self.assertEqual([(entry["event"], entry["arguments"][-1]) for entry in self.requests()],
                         [("start", "off"), ("finish", "off"), ("start", "on"), ("finish", "on")])
        self.assertEqual(self.call("lock", "status"), "locked")
        self.assertEqual(self.state()["unlockCalls"], 0)

    def test_success_during_inflight_off_still_queues_wake(self):
        self.start()
        self.lock()
        (self.root / "block-off").touch()
        self.call("test", "displayIdle", "true")
        self.until(lambda: len(self.requests()) == 1)
        self.call("test", "complete", "0")
        self.assertEqual(self.call("lock", "status"), "idle")
        self.assertEqual(self.state()["powerDesired"], "on")
        self.assertEqual(self.call("lock", "stop"), "ok")
        self.assertTrue(self.state()["stopping"])
        self.assertEqual(self.call("lock", "lock"), "refused")
        (self.root / "release-off").touch()
        self.until(lambda: len(self.requests()) == 4)
        self.assertEqual(self.requests()[-1]["arguments"][-2:], ["display", "on"])
        self.process.wait(timeout=5)
        self.assertEqual(self.process.returncode, 0, self.logs())

    def test_failed_power_request_is_not_retried_forever_and_resume_still_wakes(self):
        self.start()
        self.lock()
        (self.root / "fail-display").touch()
        self.call("test", "displayIdle", "true")
        self.until(lambda: len(self.requests()) == 2)
        self.until(lambda: not self.state()["powerBusy"])
        time.sleep(0.15)
        self.assertEqual(len(self.requests()), 2)
        self.call("test", "displayIdle", "false")
        self.until(lambda: len(self.requests()) == 4)
        self.assertEqual(self.requests()[-1]["arguments"][-2:], ["display", "on"])
        self.assertEqual(self.call("lock", "status"), "locked")

    def test_stop_idle_is_atomic_and_source_changes_do_not_reload(self):
        self.start()
        shell = self.renderer / "shell.qml"
        shell.write_text(shell.read_text() + "\n// This edit must not replace the lock process.\n")
        time.sleep(0.2)
        self.assertNotIn("Reloading", self.logs())
        self.assertEqual(self.call("lock", "status"), "idle")
        self.assertEqual(self.call("lock", "stop"), "ok")
        self.process.wait(timeout=5)
        self.assertEqual(self.process.returncode, 0, self.logs())

    def test_invalid_startup_snapshots_exit_with_diagnostic(self):
        for variable, value in (("LUNA_LOCK_SETTINGS", "not json"), ("LUNA_LOCK_SETTINGS", ""),
                                ("LUNA_LOCK_THEME", "null"), ("LUNA_LOCK_COMMAND", "[]")):
            with self.subTest(variable=variable, value=value):
                result = subprocess.run([QUICKSHELL, "--no-color", "-p", str(self.renderer)],
                                        env=dict(self.env, **{variable: value}), cwd=self.root,
                                        capture_output=True, text=True, timeout=10)
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("Luna lock startup:", result.stdout + result.stderr)

    def test_production_view_keyboard_mouse_and_secret_clearing(self):
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
        Tests.LockViewTests { anchors.fill: parent; when: host.active }
    }
    Timer { interval: 15000; running: true; onTriggered: Qt.exit(98) }
}
''')
        result = subprocess.run([QUICKSHELL, "--no-color", "-p", str(self.root)], env=self.env,
                                cwd=self.root, capture_output=True, text=True, timeout=20)
        output = result.stdout + result.stderr
        self.assertEqual(result.returncode, 0, output)
        summary = re.search(r"LUNA_LOCK_TEST_RESULT (\{[^\n]+\})", output)
        self.assertIsNotNone(summary, output)
        counts = json.loads(summary.group(1))
        self.assertEqual(counts["failed"], 0, output)
        self.assertEqual(counts["skipped"], 0, output)
        expected = len(re.findall(r"function test_\w+\(", (APP / "tests/fixtures/LockViewTests.qml").read_text()))
        self.assertEqual(counts["passed"], expected + 1, output)
        for error in ("ReferenceError", "TypeError", "Binding loop", "Unable to assign"):
            self.assertNotIn(error, output)
