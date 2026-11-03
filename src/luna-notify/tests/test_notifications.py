"""Exercise native D-Bus delivery and the production toast UI on an isolated bus."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest

import gi
gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib

APP = Path(__file__).resolve().parents[1]
QS = shutil.which("qs")


@unittest.skipUnless(QS and shutil.which("dbus-daemon"), "Quickshell and D-Bus required")
class NotificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="luna-notify ' ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ("config", "cache", "data", "runtime", "home"):
            (self.root / name).mkdir(mode=0o700)
        self.env = dict(os.environ, QT_QPA_PLATFORM="offscreen", QT_QUICK_BACKEND="software",
                        HOME=str(self.root / "home"), XDG_CONFIG_HOME=str(self.root / "config"),
                        XDG_DATA_HOME=str(self.root / "data"), XDG_RUNTIME_DIR=str(self.root / "runtime"),
                        XDG_CACHE_HOME=str(self.root / "cache"), QS_NO_RELOAD_POPUP="1")
        for name in ("WAYLAND_DISPLAY", "DISPLAY", "HYPRLAND_INSTANCE_SIGNATURE"):
            self.env.pop(name, None)
        theme = subprocess.run(["bun", "src/luna-cli/src/index.ts", "--json", "theme", "get"],
                               cwd=APP.parents[1], env=self.env, capture_output=True, text=True, check=True)
        self.env["LUNA_NOTIFY_THEME"] = json.dumps(json.loads(theme.stdout)["data"])
        self.bus = subprocess.Popen(["dbus-daemon", "--session", "--nofork", "--print-address=1"],
                                    env=self.env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        self.addCleanup(self.stop_process, self.bus)
        self.env["DBUS_SESSION_BUS_ADDRESS"] = self.bus.stdout.readline().strip()
        self.connection = Gio.DBusConnection.new_for_address_sync(
            self.env["DBUS_SESSION_BUS_ADDRESS"], Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT |
            Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION, None, None)
        self.addCleanup(self.connection.close_sync, None)
        self.events = []
        subscription = self.connection.signal_subscribe(None, "org.freedesktop.Notifications", None,
            "/org/freedesktop/Notifications", None, Gio.DBusSignalFlags.NONE,
            lambda _c, _s, _p, _i, name, args: self.events.append((name, args.unpack())))
        self.addCleanup(self.connection.signal_unsubscribe, subscription)
        self.shell = self.root / "shell"
        shutil.copytree(APP / "src/shell", self.shell)
        card_path = self.shell / "ToastCard.qml"
        card_path.write_text(card_path.read_text().replace("id: card", "id: card\n    readonly property bool testHovered: hover.hovered"))
        path = self.shell / "ToastWindow.qml"
        # Offscreen Qt lacks layer-shell; all production content, timers and model wiring remain.
        content = path.read_text().replace("PanelWindow {", "FloatingWindow {").replace("import QtQuick", "import QtQuick.Window\nimport QtQuick", 1)
        content = content.replace("keyboard = true;", "keyboard = true; contentItem.Window.window.requestActivate();")
        content = "\n".join(line for line in content.splitlines() if not line.strip().startswith(
            ("anchors { top:", "margins {", "exclusionMode:", "WlrLayershell.")))
        content = content.replace("id: panel", "id: panel\n    readonly property var testCards: cards")
        path.write_text(content)
        path = self.shell / "shell.qml"
        path.write_text(path.read_text().replace("import QtQuick", "import QtTest\nimport QtQuick.Window\nimport QtQuick", 1).rstrip()[:-1] + '''
    TestCase { id: input; name: "ToastInput"; when: false }
    IpcHandler {
        target: "test"
        function state(): string {
            return JSON.stringify({visible: shell.toasts.visible, keyboard: shell.toasts.keyboard,
                focus: shell.toasts.contentItem.Window.window && shell.toasts.contentItem.Window.window.activeFocusItem ? shell.toasts.contentItem.Window.window.activeFocusItem.objectName : "",
                entries: notificationStore.notifications.map(n => ({id: n.id, title: n.summary, body: n.body})),
                cards: Array.from({length: shell.toasts.testCards.count}, (_, i) => {
                    const c = shell.toasts.testCards.itemAt(i);
                    return {duration: c.duration, remaining: c.remaining, height: c.implicitHeight, hovered: c.testHovered};
                })});
        }
        function moveAway(): void { input.mouseMove(shell.toasts.contentItem, -50, -50); }
        function clickClose(): void { input.mouseClick(input.findChild(shell.toasts.contentItem, "dismiss")); }
        function clickDefault(): void { input.mouseClick(input.findChild(shell.toasts.contentItem, "content")); }
        function press(key: int): void { input.keyClick(key); }
        function action(index: int): void {
            const n = notificationStore.notifications[0];
            n.actions[index].invoke();
        }
    }
}
''')
        self.log = (self.root / "renderer.log").open("w")
        self.addCleanup(self.log.close)
        self.process = subprocess.Popen([QS, "--no-color", "-p", str(self.shell)], env=self.env,
                                        stdout=self.log, stderr=subprocess.STDOUT)
        self.addCleanup(self.stop_process, self.process)
        self.wait_for(lambda: self.ipc("notify", "pid", check=False).returncode == 0)
        self.wait_for(lambda: self.state()["entries"] == [])

    @staticmethod
    def stop_process(process):
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)
        if process.stdout:
            process.stdout.close()

    def wait_for(self, predicate, timeout=4):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            while GLib.MainContext.default().iteration(False):
                pass
            if predicate():
                return
            time.sleep(.025)
        self.fail("Timed out:\n" + (self.root / "renderer.log").read_text())

    def ipc(self, target, method, *args, check=True):
        result = subprocess.run([QS, "ipc", "-p", str(self.shell), "call", "--", target, method, *map(str, args)],
                                env=self.env, capture_output=True, text=True, timeout=3)
        if check:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr + (self.root / "renderer.log").read_text())
        return result

    def state(self):
        result = self.ipc("test", "state").stdout
        self.assertTrue(result.strip(), (self.root / "renderer.log").read_text())
        return json.loads(result)

    def notify(self, title="Hello", body="From an application", timeout=0, replace=0, actions=None, urgency=1):
        result = self.connection.call_sync("org.freedesktop.Notifications", "/org/freedesktop/Notifications",
            "org.freedesktop.Notifications", "Notify",
            GLib.Variant("(susssasa{sv}i)", ("Fixture", replace, "", title, body, actions or [],
                {"urgency": GLib.Variant("y", urgency)}, timeout)), None, Gio.DBusCallFlags.NONE, 3000, None)
        return result.unpack()[0]

    def test_delivery_replacement_dismiss_and_client_close_have_no_history(self):
        identifier = self.notify(title="<b>Literal title</b>", body="<script>literal body</script>")
        self.wait_for(lambda: len(self.state()["entries"]) == 1)
        self.assertTrue(self.state()["visible"])
        self.assertFalse(self.state()["keyboard"])
        self.assertEqual(self.state()["entries"][0]["title"], "<b>Literal title</b>")
        self.assertEqual(self.notify(title="Updated", replace=identifier), identifier)
        self.wait_for(lambda: self.state()["entries"][0]["title"] == "Updated")
        self.assertEqual(len(self.state()["entries"]), 1)
        self.ipc("notify", "focus")
        self.assertTrue(self.state()["keyboard"])
        self.ipc("test", "clickClose")
        self.wait_for(lambda: self.state()["entries"] == [])
        self.assertFalse(self.state()["visible"])
        self.assertFalse(self.state()["keyboard"])
        self.wait_for(lambda: ("NotificationClosed", (identifier, 2)) in self.events)
        identifier = self.notify()
        self.connection.call_sync("org.freedesktop.Notifications", "/org/freedesktop/Notifications",
            "org.freedesktop.Notifications", "CloseNotification", GLib.Variant("(u)", (identifier,)),
            None, Gio.DBusCallFlags.NONE, 3000, None)
        self.wait_for(lambda: self.state()["entries"] == [])
        self.wait_for(lambda: ("NotificationClosed", (identifier, 3)) in self.events)

    def test_timeouts_use_milliseconds_default_critical_and_replacement_timer(self):
        identifier = self.notify(timeout=350)
        self.wait_for(lambda: len(self.state()["cards"]) == 1)
        self.assertEqual(self.state()["cards"][0]["duration"], 350)
        self.ipc("test", "moveAway")
        self.wait_for(lambda: ("NotificationClosed", (identifier, 1)) in self.events)
        self.assertEqual(self.state()["entries"], [])
        identifier = self.notify(timeout=-1)
        self.wait_for(lambda: len(self.state()["cards"]) == 1)
        self.assertEqual(self.state()["cards"][0]["duration"], 5000)
        self.notify(title="Persistent update", timeout=0, replace=identifier)
        self.wait_for(lambda: self.state()["cards"][0]["duration"] == 0)
        self.assertEqual(self.state()["cards"][0]["remaining"], 0)
        self.ipc("notify", "dismiss")
        self.notify(urgency=2, timeout=100)
        self.wait_for(lambda: len(self.state()["cards"]) == 1)
        self.assertEqual(self.state()["cards"][0]["duration"], 0)

    def test_real_cli_confirms_ownership_and_restarts_the_daemon(self):
        repository = self.root / "checkout"
        source = repository / "src/luna-notify/src/shell"
        source.parent.mkdir(parents=True)
        source.symlink_to(self.shell, target_is_directory=True)

        def run(action):
            result = subprocess.run(["bun", "src/luna-cli/src/index.ts", "--json", "notify",
                "--install-dir", str(repository), action], cwd=APP.parents[1], env=self.env,
                capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            return json.loads(result.stdout)["data"]

        self.addCleanup(lambda: subprocess.run([QS, "kill", "-p", str(self.shell)], env=self.env,
                                              capture_output=True, timeout=5))
        self.assertTrue(run("status")["running"])
        self.assertTrue(run("start")["running"])
        self.assertIsNone(self.process.poll())
        self.assertFalse(run("stop")["running"])
        self.process.wait(timeout=3)
        self.assertTrue(run("start")["running"])
        identifier = self.notify()
        self.wait_for(lambda: len(self.state()["entries"]) == 1)
        self.assertTrue(run("restart")["running"])
        self.wait_for(lambda: self.state()["entries"] == [])
        self.assertFalse(run("stop")["running"])
        self.assertTrue(run("start")["running"])

    def test_keyboard_navigation_pause_escape_and_dismiss(self):
        identifier = self.notify(timeout=300, actions=["default", "Open", "reply", "Reply"])
        self.wait_for(lambda: len(self.state()["cards"]) == 1)
        self.ipc("notify", "focus")
        self.wait_for(lambda: self.state()["focus"] == "dismiss")
        self.ipc("test", "moveAway")
        time.sleep(.4)
        self.assertEqual(len(self.state()["entries"]), 1)
        self.ipc("test", "press", 16777217)  # Tab reaches the default action.
        self.wait_for(lambda: self.state()["focus"] == "content")
        self.ipc("test", "press", 16777220)  # Return invokes it.
        self.wait_for(lambda: ("ActionInvoked", (identifier, "default")) in self.events)
        self.wait_for(lambda: self.state()["entries"] == [])
        identifier = self.notify()
        self.wait_for(lambda: len(self.state()["entries"]) == 1)
        self.ipc("notify", "focus")
        self.wait_for(lambda: self.state()["focus"] == "dismiss")
        self.ipc("test", "press", 16777216)  # Escape releases keyboard focus.
        self.wait_for(lambda: not self.state()["keyboard"])
        self.assertEqual(len(self.state()["entries"]), 1)
        self.ipc("notify", "focus")
        self.ipc("test", "press", 16777223)  # Delete dismisses the focused toast.
        self.wait_for(lambda: ("NotificationClosed", (identifier, 2)) in self.events)
        self.wait_for(lambda: self.state()["entries"] == [])

    def test_bursts_remain_bounded_and_actions_reach_the_sender(self):
        identifiers = [self.notify(title=f"Toast {i}") for i in range(6)]
        self.wait_for(lambda: len(self.state()["entries"]) == 3)
        self.assertEqual([n["id"] for n in self.state()["entries"]], identifiers[-3:])
        for identifier in identifiers[:3]:
            self.wait_for(lambda: ("NotificationClosed", (identifier, 1)) in self.events)
        for _ in range(3):
            self.ipc("notify", "dismiss")
        identifier = self.notify(actions=["default", "Open", "reply", "Reply"])
        self.wait_for(lambda: len(self.state()["entries"]) == 1)
        self.ipc("test", "action", 1)
        self.wait_for(lambda: ("ActionInvoked", (identifier, "reply")) in self.events)
        self.wait_for(lambda: self.state()["entries"] == [])
        identifier = self.notify(actions=["default", "Open"])
        self.wait_for(lambda: len(self.state()["entries"]) == 1)
        self.ipc("test", "clickDefault")
        self.wait_for(lambda: ("ActionInvoked", (identifier, "default")) in self.events)
        self.wait_for(lambda: self.state()["entries"] == [])
        output = (self.root / "renderer.log").read_text()
        for error in ("ReferenceError", "TypeError", "Binding loop", "Unable to assign"):
            self.assertNotIn(error, output)


if __name__ == "__main__":
    unittest.main()
