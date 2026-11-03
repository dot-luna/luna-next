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
        # Luna-specific roots take precedence over HOME/XDG and must never reach the host.
        for name in tuple(self.env):
            if name.startswith("LUNA_"):
                self.env.pop(name)
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
        content = content.replace("id: panel", "id: panel\n    readonly property var testCards: cards\n    readonly property Item testStack: stack")
        path.write_text(content)
        path = self.shell / "shell.qml"
        path.write_text(path.read_text().replace("import QtQuick", "import QtTest\nimport QtQuick.Window\nimport QtQuick", 1).rstrip()[:-1] + '''
    TestCase { id: input; name: "ToastInput"; when: false }
    IpcHandler {
        target: "test"
        function state(): string {
            return JSON.stringify({visible: shell.toasts.visible, keyboard: shell.toasts.keyboard, expanded: shell.toasts.expanded,
                width: shell.toasts.implicitWidth,
                focus: shell.toasts.contentItem.Window.window && shell.toasts.contentItem.Window.window.activeFocusItem ? shell.toasts.contentItem.Window.window.activeFocusItem.objectName : "",
                entries: notificationStore.notifications.map(n => ({id: n.id, title: n.summary, body: n.body})),
                cards: Array.from({length: shell.toasts.testCards.count}, (_, i) => {
                    const c = shell.toasts.testCards.itemAt(i);
                    const avatar = input.findChild(c, "avatar");
                    const image = input.findChild(c, "contactImage");
                    const fallback = input.findChild(c, "priorityIcon");
                    const strip = input.findChild(c, "priorityStrip");
                    return {duration: c.duration, remaining: c.remaining, height: c.implicitHeight, hovered: c.testHovered,
                        y: c.y, exposed: c.exposed, opacity: c.opacity,
                        priority: {title: c.style.title_color, body: c.style.text_color,
                            stripWidth: strip.width, stripColor: String(strip.color), stripX: strip.x, borderColor: String(c.border.color),
                            fallbackVisible: fallback.visible, fallbackReady: fallback.status === Image.Ready,
                            icon: c.style.icon},
                        avatar: {width: avatar.width, height: avatar.height,
                        visible: avatar.visible, imageWidth: image.width, imageHeight: image.height, ready: image.status === Image.Ready}};
                })});
        }
        function hoverStack(): void { input.mouseMove(shell.toasts.testCards.itemAt(shell.toasts.testCards.count - 1), 30, 20); }
        function moveAway(): void { input.mouseMove(shell.toasts.contentItem, -50, -50); }
        function clickToast(right: bool): void {
            input.mouseClick(shell.toasts.testCards.itemAt(shell.toasts.testCards.count - 1), 30, 20,
                right ? Qt.RightButton : Qt.LeftButton);
        }
        function capture(path: string): void {
            shell.toasts.testStack.grabToImage(result => result.saveToFile(path));
        }
        function press(key: int): void { input.keyClick(key); }
    }
}
''')
        self.config = self.root / "config/luna/notify.jsonc"
        self.env["LUNA_NOTIFY_SETTINGS"] = json.dumps(self.settings_snapshot()["settings"])
        self.log = (self.root / "renderer.log").open("w")
        self.addCleanup(self.log.close)
        self.process = subprocess.Popen([QS, "--no-color", "-p", str(self.shell)], env=self.env,
                                        stdout=self.log, stderr=subprocess.STDOUT)
        self.addCleanup(self.stop_process, self.process)
        self.wait_for(lambda: self.ipc("notify", "pid", check=False).returncode == 0)
        self.wait_for(lambda: self.state()["entries"] == [])

    def settings_snapshot(self):
        script = "import {notifySnapshot} from './packages/luna-api/src/notify/settings.ts'; " + \
                 "console.log(JSON.stringify(await notifySnapshot({env:Bun.env,configFile:Bun.argv[1],shellDirectory:Bun.argv[2]})));"
        result = subprocess.run(["bun", "-e", script, str(self.config), str(self.shell)],
                                cwd=APP.parents[1], env=self.env, capture_output=True, text=True, check=True)
        return json.loads(result.stdout)

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

    def notify(self, title="Hello", body="From an application", timeout=0, replace=0, actions=None, urgency=1, hints=None, app="Fixture", icon=""):
        result = self.connection.call_sync("org.freedesktop.Notifications", "/org/freedesktop/Notifications",
            "org.freedesktop.Notifications", "Notify",
            GLib.Variant("(susssasa{sv}i)", (app, replace, icon, title, body, actions or [],
                {"urgency": GLib.Variant("y", urgency), **(hints or {})}, timeout)), None, Gio.DBusCallFlags.NONE, 3000, None)
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
        self.ipc("test", "clickToast", "true")
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
        identifier = self.notify(urgency=2, timeout=250)
        self.wait_for(lambda: len(self.state()["cards"]) == 1)
        self.assertEqual(self.state()["cards"][0]["duration"], 250)
        self.ipc("test", "moveAway")
        self.wait_for(lambda: ("NotificationClosed", (identifier, 1)) in self.events)
        self.notify(urgency=2, timeout=-1)
        self.wait_for(lambda: len(self.state()["cards"]) == 1)
        self.assertEqual(self.state()["cards"][0]["duration"], 0)

    def test_replacements_reset_changed_content_but_identical_payloads_have_no_native_event(self):
        identifier = self.notify(timeout=1800)
        self.wait_for(lambda: len(self.state()["cards"]) == 1)
        self.ipc("test", "moveAway")
        self.wait_for(lambda: self.state()["cards"][0]["remaining"] < 1300)
        remaining = self.state()["cards"][0]["remaining"]
        self.assertEqual(self.notify(timeout=1800, replace=identifier), identifier)
        self.assertLessEqual(self.state()["cards"][0]["remaining"], remaining)
        self.notify(title="Updated", timeout=1800, replace=identifier)
        self.wait_for(lambda: self.state()["cards"][0]["remaining"] > 1600)
        self.assertEqual(len(self.state()["entries"]), 1)

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

    def test_keyboard_navigation_pause_open_escape_and_dismiss(self):
        older = self.notify(timeout=300)
        newest = self.notify(timeout=300, actions=["open", "Open"])
        self.wait_for(lambda: len(self.state()["cards"]) == 2)
        self.ipc("notify", "focus")
        self.wait_for(lambda: self.state()["focus"] == f"toast-{newest}")
        self.assertTrue(self.state()["expanded"])
        self.ipc("test", "moveAway")
        time.sleep(.4)
        self.assertEqual(len(self.state()["entries"]), 2)
        self.ipc("test", "press", 16777217)  # Tab selects the older toast.
        self.wait_for(lambda: self.state()["focus"] == f"toast-{older}")
        self.ipc("test", "press", 16777216)  # Escape dismisses that toast.
        self.wait_for(lambda: ("NotificationClosed", (older, 2)) in self.events)
        self.wait_for(lambda: self.state()["focus"] == f"toast-{newest}")
        self.ipc("test", "press", 16777220)  # Return invokes Whatly's open action.
        self.wait_for(lambda: ("ActionInvoked", (newest, "open")) in self.events)
        self.wait_for(lambda: self.state()["entries"] == [])
        identifier = self.notify()
        self.wait_for(lambda: len(self.state()["entries"]) == 1)
        self.ipc("notify", "focus")
        self.wait_for(lambda: self.state()["focus"] == f"toast-{identifier}")
        self.ipc("test", "press", 16777223)
        self.wait_for(lambda: ("NotificationClosed", (identifier, 2)) in self.events)
        self.wait_for(lambda: self.state()["entries"] == [])

    def test_opening_a_resident_notification_closes_it_and_returns_focus_with_other_toasts_pending(self):
        older = self.notify(title="Older")
        newest = self.notify(title="Resident", actions=["open", "Open"],
                             hints={"resident": GLib.Variant("b", True)})
        self.wait_for(lambda: len(self.state()["cards"]) == 2)
        self.ipc("notify", "focus")
        self.wait_for(lambda: self.state()["focus"] == f"toast-{newest}")
        self.ipc("test", "press", 16777220)
        self.wait_for(lambda: ("ActionInvoked", (newest, "open")) in self.events)
        self.wait_for(lambda: ("NotificationClosed", (newest, 2)) in self.events)
        self.wait_for(lambda: len(self.state()["entries"]) == 1)
        self.assertEqual(self.state()["entries"][0]["id"], older)
        self.assertFalse(self.state()["keyboard"])

    def test_collapsed_stack_pauses_covered_toasts_and_reveals_them_on_dismiss(self):
        older = self.notify(title="Older", timeout=500)
        newest = self.notify(title="Newest")
        self.wait_for(lambda: len(self.state()["cards"]) == 2)
        self.ipc("test", "moveAway")
        self.wait_for(lambda: not self.state()["expanded"])
        self.assertFalse(self.state()["cards"][0]["exposed"])
        self.assertTrue(self.state()["cards"][1]["exposed"])
        self.ipc("test", "hoverStack")
        self.wait_for(lambda: self.state()["expanded"])
        self.assertTrue(all(card["exposed"] for card in self.state()["cards"]))
        self.ipc("test", "moveAway")
        self.wait_for(lambda: not self.state()["expanded"])
        time.sleep(.6)
        self.assertEqual(len(self.state()["entries"]), 2)
        self.ipc("notify", "dismiss")
        self.wait_for(lambda: ("NotificationClosed", (newest, 2)) in self.events)
        self.wait_for(lambda: self.state()["cards"][0]["exposed"])
        self.wait_for(lambda: ("NotificationClosed", (older, 1)) in self.events)
        self.assertEqual(self.state()["entries"], [])

    def test_whatly_image_data_stays_a_small_avatar_and_open_is_the_whole_toast(self):
        identifier = self.notify(title="Aarav", body="Are you free later?", app="Whatly",
            actions=["open", "Open"], hints={"image-data": GLib.Variant("(iiibiiay)",
                (128, 64, 512, True, 8, 4, [80, 160, 130, 255] * 128 * 64))})
        self.wait_for(lambda: len(self.state()["cards"]) == 1 and self.state()["cards"][0]["avatar"]["ready"])
        card = self.state()["cards"][0]
        self.assertEqual(card["avatar"]["width"], 36)
        self.assertEqual(card["avatar"]["height"], 36)
        self.assertEqual(card["avatar"]["imageWidth"], 36)
        self.assertEqual(card["avatar"]["imageHeight"], 36)
        self.assertFalse(card["priority"]["fallbackVisible"])
        self.assertLessEqual(card["height"], 80)
        self.ipc("test", "clickToast", "false")
        self.wait_for(lambda: ("ActionInvoked", (identifier, "open")) in self.events)
        self.wait_for(lambda: self.state()["entries"] == [])

    def test_critical_alerts_survive_stack_overflow_until_dismissed(self):
        critical = [self.notify(title=f"Critical {i}", urgency=2, timeout=0) for i in range(4)]
        for i in range(5):
            self.notify(title=f"Normal {i}", timeout=100)
        self.ipc("test", "moveAway")
        time.sleep(.3)
        self.assertEqual([entry["id"] for entry in self.state()["entries"]], critical)
        self.assertTrue(all(("NotificationClosed", (identifier, 1)) not in self.events for identifier in critical))
        self.ipc("notify", "focus")
        self.wait_for(lambda: self.state()["expanded"])
        self.ipc("notify", "dismiss")
        self.wait_for(lambda: ("NotificationClosed", (critical[-1], 2)) in self.events)
        self.assertEqual(len(self.state()["entries"]),3)

    def test_sender_requested_persistence_is_retained_when_the_stack_fills(self):
        sticky = [self.notify(title=f"Keep {i}", urgency=0, timeout=0) for i in range(4)]
        for i in range(5):
            self.notify(title=f"Normal {i}", timeout=100)
        self.ipc("test", "moveAway")
        time.sleep(.3)
        self.assertEqual([entry["id"] for entry in self.state()["entries"]], sticky)
        self.assertEqual([card["duration"] for card in self.state()["cards"]], [0] * 4)
        self.ipc("notify", "dismiss")
        self.wait_for(lambda: ("NotificationClosed", (sticky[-1], 2)) in self.events)

    def test_priority_styles_and_missing_icon_fallback(self):
        for urgency, icon, opacity, strip_width in [(0, "information-circle", .65, 0),
                                                   (1, "notification-02", 1, 0),
                                                   (2, "alert-02", 1, 4)]:
            with self.subTest(urgency=urgency):
                self.notify(urgency=urgency)
                self.wait_for(lambda: len(self.state()["cards"]) == 1)
                self.wait_for(lambda: self.state()["cards"][0]["priority"]["fallbackReady"])
                self.wait_for(lambda: abs(self.state()["cards"][0]["opacity"] - opacity) < .01)
                card = self.state()["cards"][0]
                self.assertTrue(card["priority"]["fallbackVisible"])
                self.assertEqual(card["priority"]["icon"], icon)
                self.assertEqual(card["priority"]["stripWidth"], strip_width)
                if urgency == 2:
                    self.assertEqual(card["priority"]["title"], card["priority"]["stripColor"])
                    self.assertNotEqual(card["priority"]["borderColor"], card["priority"]["stripColor"])
                    self.assertEqual(card["priority"]["stripX"], 0)
                self.ipc("notify", "dismiss")
                self.wait_for(lambda: self.state()["entries"] == [])
        self.notify(icon=str(self.root / "missing-icon.png"))
        self.wait_for(lambda: len(self.state()["cards"]) == 1)
        self.wait_for(lambda: self.state()["cards"][0]["priority"]["fallbackVisible"])

    def test_jsonc_controls_renderer_size_stack_limit_hover_and_priority_style(self):
        self.config.write_text(json.dumps({"timeout_ms":300, "appearance":{"width":320, "avatar_size":28},
            "stack":{"limit":2, "expand_on_hover":False},
            "priority":{"critical":{"strip_width":7, "strip_side":"right", "title_color":"#ff8877", "strip_color":"#ff8877"}}}))
        repository = self.root / "config-checkout"
        source = repository / "src/luna-notify/src/shell"
        source.parent.mkdir(parents=True)
        source.symlink_to(self.shell, target_is_directory=True)
        result = subprocess.run(["bun", "src/luna-cli/src/index.ts", "--json", "notify",
            "--install-dir", str(repository), "restart"], cwd=APP.parents[1], env=self.env,
            capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.addCleanup(lambda: subprocess.run([QS,"kill","-p",str(self.shell)],env=self.env,capture_output=True,timeout=5))
        self.assertEqual(self.state()["width"],320)
        for i in range(3):
            self.notify(title=f"Custom {i}",urgency=2 if i == 2 else 1, timeout=0 if i == 2 else -1)
        self.wait_for(lambda: len(self.state()["cards"]) == 2)
        self.ipc("test", "hoverStack")
        self.assertFalse(self.state()["expanded"])
        card = self.state()["cards"][-1]
        self.assertEqual(card["avatar"]["width"],28)
        self.assertEqual(card["priority"]["stripWidth"],7)
        self.assertAlmostEqual(card["priority"]["stripX"], 313, delta=.5)
        self.assertEqual(card["priority"]["title"],"#ff8877")
        self.ipc("notify", "focus")
        self.wait_for(lambda: self.state()["expanded"])
        for _ in range(2):
            self.ipc("notify", "dismiss")
        critical = self.notify(title="Critical remains", urgency=2, timeout=0)
        for urgency in (0, 1):
            identifier = self.notify(title="Automatic dismissal", urgency=urgency, timeout=-1)
            self.ipc("test", "moveAway")
            self.wait_for(lambda: ("NotificationClosed", (identifier, 1)) in self.events)
        self.assertEqual([entry["id"] for entry in self.state()["entries"]], [critical])

    def test_bursts_remain_bounded_and_actions_reach_the_sender(self):
        identifiers = [self.notify(title=f"Toast {i}", timeout=-1) for i in range(6)]
        self.wait_for(lambda: len(self.state()["entries"]) == 3)
        self.assertEqual([n["id"] for n in self.state()["entries"]], identifiers[-3:])
        for identifier in identifiers[:3]:
            self.wait_for(lambda: ("NotificationClosed", (identifier, 1)) in self.events)
        for _ in range(3):
            self.ipc("notify", "dismiss")
        identifier = self.notify(actions=["default", "Open", "open", "Open app", "delete", "Delete"])
        self.wait_for(lambda: len(self.state()["entries"]) == 1)
        self.ipc("test", "clickToast", "false")
        self.wait_for(lambda: ("ActionInvoked", (identifier, "default")) in self.events)
        self.wait_for(lambda: self.state()["entries"] == [])
        identifier = self.notify(actions=["delete", "Delete"])
        self.wait_for(lambda: len(self.state()["entries"]) == 1)
        self.ipc("test", "clickToast", "false")
        self.assertEqual(len(self.state()["entries"]), 1)
        self.assertNotIn(("ActionInvoked", (identifier, "delete")), self.events)
        self.ipc("test", "clickToast", "true")
        self.wait_for(lambda: ("NotificationClosed", (identifier, 2)) in self.events)
        output = (self.root / "renderer.log").read_text()
        for error in ("ReferenceError", "TypeError", "Binding loop", "Unable to assign"):
            self.assertNotIn(error, output)


if __name__ == "__main__":
    unittest.main()
