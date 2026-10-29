"""Exercise the native PolkitAgent against a private authority, without PAM."""

import json
from pathlib import Path
import select
import shutil
import subprocess
import tempfile
import time
import unittest

from _support import QUICKSHELL, SHELL, isolated_environment, system_python


DBUS_DAEMON = shutil.which("dbus-daemon")
AUTHORITY = Path(__file__).parent / "fixtures/fake_authority.py"


@unittest.skipUnless(QUICKSHELL and DBUS_DAEMON, "Quickshell and dbus-daemon required")
class PolkitBackendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.python = system_python()
        if cls.python is None:
            raise unittest.SkipTest("PyGObject and Polkit introspection are required")
        # Quickshell resolves its login session through libsystemd; setting
        # XDG_SESSION_ID cannot replace a real session in Quickshell 0.3.2.
        probe = subprocess.run(
            [cls.python, "-c", "import os, gi; gi.require_version('Polkit', '1.0'); "
             "from gi.repository import Polkit; "
             "Polkit.UnixSession.new_for_process_sync(os.getpid(), None)"],
            capture_output=True, timeout=5,
        )
        if probe.returncode:
            raise unittest.SkipTest("The real PolkitAgent requires a logind session")

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="luna-next-polkit-backend-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.env = isolated_environment(self.root)
        self.renderer = self.root / "renderer"
        shutil.copytree(SHELL, self.renderer)
        # Keep the production controller and native agent. Offscreen Qt cannot
        # render a compositor overlay, which is covered by the separate UI suite.
        (self.renderer / "AuthDialog.qml").write_text("""import QtQuick
QtObject {
    property var flow
    property var screen
    property var theme
}
""")
        self.events_path = self.root / "events.jsonl"
        self.shell_log_path = self.root / "shell.log"

        # No activation directories: test requests cannot start system services.
        bus_config = self.root / "bus.conf"
        bus_config.write_text(f"""<busconfig>
            <type>session</type>
            <listen>unix:tmpdir={self.root}</listen>
            <auth>EXTERNAL</auth>
            <policy context="default">
                <allow own="*"/>
                <allow send_destination="*"/>
                <allow receive_sender="*"/>
            </policy>
        </busconfig>""")
        self.bus = subprocess.Popen(
            [DBUS_DAEMON, "--config-file=" + str(bus_config), "--nofork", "--print-address=1"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        self.addCleanup(self.stop_process, self.bus)
        self.addCleanup(self.bus.stdout.close)
        self.addCleanup(self.bus.stderr.close)
        self.assertTrue(select.select([self.bus.stdout], [], [], 3)[0], "Private bus failed to start")
        address = self.bus.stdout.readline().strip()
        self.assertTrue(address.startswith("unix:"), "Private bus returned no Unix address")
        self.env.update(DBUS_SYSTEM_BUS_ADDRESS=address, DBUS_SESSION_BUS_ADDRESS=address,
                        LUNA_NEXT_POLKIT_TEST_BUS=address)

    @staticmethod
    def stop_process(process):
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)

    def events(self, name):
        if not self.events_path.exists():
            return []
        return [event for line in self.events_path.read_text().splitlines()
                if (event := json.loads(line))["event"] == name]

    def until(self, predicate, timeout=5):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if predicate():
                return
            time.sleep(0.025)
        logs = "\n".join(path.read_text() for path in self.root.glob("*.log"))
        self.fail("Polkit backend condition failed:\n" + logs)

    def start_authority(self, mode="accept"):
        authority_log = (self.root / "authority.log").open("w")
        self.addCleanup(authority_log.close)
        authority = subprocess.Popen(
            [self.python, str(AUTHORITY), mode, str(self.events_path)],
            env=self.env, stdout=authority_log, stderr=subprocess.STDOUT,
        )
        self.addCleanup(self.stop_process, authority)
        self.until(lambda: self.events("ready"))

    def start_shell(self):
        shell_log = self.shell_log_path.open("w")
        self.addCleanup(shell_log.close)
        self.shell = subprocess.Popen([QUICKSHELL, "--no-color", "-p", str(self.renderer)],
                                      env=self.env, stdout=shell_log, stderr=subprocess.STDOUT)
        self.addCleanup(self.stop_process, self.shell)

    def launch(self, mode="accept"):
        self.start_authority(mode)
        self.start_shell()
        self.until(lambda: self.events("registration"))
        self.until(lambda: self.ipc("status").returncode == 0)

    def ipc(self, method):
        return subprocess.run([QUICKSHELL, "ipc", "-p", str(self.renderer), "call", "polkit", method],
                              env=self.env, capture_output=True, text=True, timeout=3)

    def test_registers_real_agent_and_exposes_polkit_ipc(self):
        self.launch()
        event = self.events("registration")[0]
        self.assertEqual(event["subject"], "unix-session")
        self.assertTrue(event["session"])
        self.assertEqual(event["path"], "/org/lunanext/Polkit")
        self.assertEqual(self.ipc("status").stdout.strip(), "running")
        self.assertEqual(self.ipc("ping").stdout.strip(), "true")
        self.assertEqual(self.ipc("stop").returncode, 0)
        self.assertEqual(self.shell.wait(timeout=4), 0)
        self.until(lambda: self.events("unregistration"))

    def test_unsupported_identity_is_cancelled_without_starting_pam(self):
        self.launch("unsupported")
        self.until(lambda: self.events("unsupported_cancelled"))
        error = self.events("unsupported_cancelled")[0]["error"]
        self.assertIn("org.freedesktop.PolicyKit1.Error.Cancelled", error)
        self.assertIn("no supported identities", error)
        self.assertEqual(self.ipc("status").stdout.strip(), "running")
        self.assertEqual(self.ipc("ping").stdout.strip(), "true")

    def test_registration_failure_reports_unavailable_and_exits(self):
        self.launch("reject")
        self.assertEqual(self.ipc("status").stdout.strip(), "unavailable")
        self.assertEqual(self.ipc("ping").stdout.strip(), "false")
        self.assertNotEqual(self.shell.wait(timeout=20), 0)

    def test_validation_exits_without_registering(self):
        self.start_authority()
        self.env["LUNA_NEXT_POLKIT_VALIDATE"] = "1"
        self.start_shell()
        self.assertEqual(self.shell.wait(timeout=5), 0, self.shell_log_path.read_text())
        self.assertIn("Luna Next polkit validation passed", self.shell_log_path.read_text())
        self.assertEqual(self.events("registration"), [])

    def test_invalid_theme_fails_before_registering(self):
        self.start_authority()
        self.env["LUNA_NEXT_POLKIT_THEME"] = "{}"
        self.start_shell()
        self.assertNotEqual(self.shell.wait(timeout=5), 0)
        self.assertEqual(self.events("registration"), [])


if __name__ == "__main__":
    unittest.main()
