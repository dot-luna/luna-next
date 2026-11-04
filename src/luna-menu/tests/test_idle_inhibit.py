"""Real D-Bus requests on a private bus; never inhibit the user's session."""

import json
import os
from pathlib import Path
import select
import shutil
import subprocess
import sys
import time
import unittest

try:
    import dbus
except ImportError:
    dbus = None


SCRIPT = Path(__file__).resolve().parents[1] / "src/shell/idle_inhibit.py"
SERVICE = "org.freedesktop.ScreenSaver"
PATH = "/org/freedesktop/ScreenSaver"


@unittest.skipUnless(dbus and shutil.which("dbus-daemon"), "python-dbus and dbus-daemon required")
class IdleInhibitTests(unittest.TestCase):
    def setUp(self):
        self.daemon = subprocess.Popen(["dbus-daemon", "--session", "--nofork", "--print-address=1"],
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.addCleanup(self.stop, self.daemon)
        self.address = self.daemon.stdout.readline().strip()
        self.bus = self.connection()
        self.bridge = None

    def stop(self, process):
        if process.poll() is None:
            process.terminate()
        process.communicate(timeout=5)

    def connection(self):
        connection = dbus.bus.BusConnection(self.address)
        self.addCleanup(connection.close)
        return connection

    def start(self):
        self.bridge = subprocess.Popen([sys.executable, str(SCRIPT)], stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, text=True,
                                       env=dict(os.environ, DBUS_SESSION_BUS_ADDRESS=self.address))
        self.addCleanup(self.stop, self.bridge)
        self.state(False)
        return dbus.Interface(self.bus.get_object(SERVICE, PATH), SERVICE)

    def state(self, expected):
        ready, _, _ = select.select([self.bridge.stdout], [], [], 3)
        self.assertTrue(ready, "The bridge did not publish its state")
        line = self.bridge.stdout.readline()
        self.assertTrue(line, "The bridge exited unexpectedly")
        self.assertEqual(json.loads(line), {"inhibited": expected})

    def test_multiple_requests_release_independently_and_only_the_owner_can_release(self):
        service = self.start()
        first = service.Inhibit("video", "Playing a movie")
        self.state(True)
        second = service.Inhibit("presentation", "Showing slides")
        self.assertNotEqual(first, second)
        other = dbus.Interface(self.connection().get_object(SERVICE, PATH), SERVICE)
        other.UnInhibit(first)
        service.UnInhibit(first)
        ready, _, _ = select.select([self.bridge.stdout], [], [], 0.1)
        self.assertFalse(ready, "The second request must keep inhibition active")
        service.UnInhibit(second)
        self.state(False)
        third = service.Inhibit("video", "Playing again")
        self.state(True)
        service.UnInhibit(third)
        self.state(False)

    def test_disconnect_releases_all_requests_from_that_client(self):
        service = self.start()
        main_cookie = service.Inhibit("video", "Main client")
        self.state(True)
        client = self.connection()
        other = dbus.Interface(client.get_object(SERVICE, PATH), SERVICE)
        other.Inhibit("video", "Other client")
        other.Inhibit("video", "Another request")
        client.close()
        time.sleep(0.1)
        service.UnInhibit(main_cookie)
        self.state(False)

    def test_application_paths_share_the_same_cookie_registry(self):
        portal = self.start()
        browser = dbus.Interface(self.bus.get_object(SERVICE, "/ScreenSaver"), SERVICE)
        browser_cookie = browser.Inhibit("browser", "Watching a video")
        self.state(True)
        portal_cookie = portal.Inhibit("portal", "Presentation")
        portal.UnInhibit(browser_cookie)
        ready, _, _ = select.select([self.bridge.stdout], [], [], 0.1)
        self.assertFalse(ready, "The portal's request remains active")
        browser.UnInhibit(portal_cookie)
        self.state(False)

    def test_does_not_replace_an_existing_provider(self):
        self.bus.request_name(SERVICE, dbus.bus.NAME_FLAG_DO_NOT_QUEUE)
        result = subprocess.run([sys.executable, str(SCRIPT)], capture_output=True, text=True,
                                env=dict(os.environ, DBUS_SESSION_BUS_ADDRESS=self.address), timeout=5)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Luna idle inhibition:", result.stderr)
        self.assertEqual(self.bus.get_name_owner(SERVICE), self.bus.get_unique_name())


if __name__ == "__main__":
    unittest.main()
