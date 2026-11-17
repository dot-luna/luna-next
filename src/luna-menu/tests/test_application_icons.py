"""Exercise icon installation in a running menu with private desktop entries."""

import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time
import unittest

from _support import QUICKSHELL, SHELL, isolated_environment


SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>'


@unittest.skipUnless(QUICKSHELL and shutil.which("dbus-run-session"),
                     "Quickshell and dbus-run-session are required")
class ApplicationIconTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="luna-icons ' ")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.env = isolated_environment(self.root)
        self.env["QS_ICON_THEME"] = "hicolor"
        self.entries = self.root / "data/applications"
        self.entries.mkdir()
        self.icons = self.root / "data/icons/hicolor/scalable/apps"
        self.icons.mkdir(parents=True)
        (self.icons.parent.parent / "index.theme").write_text(
            "[Icon Theme]\nName=Hicolor\nDirectories=scalable/apps\n"
            "[scalable/apps]\nSize=32\nType=Scalable\nMinSize=1\nMaxSize=512\nContext=Applications\n")
        shutil.copytree(SHELL, self.root / "menu")
        (self.root / "shell.qml").write_text('''import QtQuick
import Quickshell
import Quickshell.Io
import "menu" as Menu

ShellRoot {
    Component.onCompleted: Quickshell.watchFiles = false
    FloatingWindow {
        visible: true
        implicitWidth: 800
        implicitHeight: 700
        Menu.MenuContent {
            id: card
            anchors.fill: parent
            theme: JSON.parse(Quickshell.env("LUNA_MENU_THEME"))
            applications: DesktopEntries.applications.values
            section: "apps"
        }
    }
    function images(item) {
        let result = [];
        if (item.sourceSize !== undefined && item.sourceSize.width === 32)
            result.push({source: item.source.toString(), ready: item.status === Image.Ready});
        for (const child of item.children || []) result = result.concat(images(child));
        return result;
    }
    IpcHandler {
        target: "test"
        function state(): string {
            return JSON.stringify({names: card.entries.map(entry => entry.name), icons: images(card)});
        }
        function reopen(): void { card.reset("apps"); }
        function cachedIcon(): string { return Quickshell.iconPath("luna-late-icon", true); }
    }
}
''')
        self.log_path = self.root / "shell.log"
        log = self.log_path.open("w")
        self.addCleanup(log.close)
        self.process = subprocess.Popen(
            ["dbus-run-session", "--", QUICKSHELL, "--no-color", "-p", str(self.root)],
            env=self.env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        self.addCleanup(self.stop)
        self.wait_state(lambda state: state["names"] == [])

    def stop(self):
        if self.process.poll() is None:
            os.killpg(self.process.pid, signal.SIGTERM)
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(self.process.pid, signal.SIGKILL)
                self.process.wait(timeout=5)

    def call(self, method):
        return subprocess.run([QUICKSHELL, "ipc", "-p", str(self.root), "call", "test", method],
                              env=self.env, capture_output=True, text=True, timeout=3)

    def wait_state(self, predicate):
        deadline = time.monotonic() + 5
        state = None
        while time.monotonic() < deadline and self.process.poll() is None:
            result = self.call("state")
            if result.returncode == 0:
                state = json.loads(result.stdout)
                if predicate(state):
                    return state
            time.sleep(0.025)
        self.fail(f"Icon state did not converge: {state}\n{self.log_path.read_text()}")

    def entry(self, icon):
        (self.entries / "fixture.desktop").write_text(
            f"[Desktop Entry]\nType=Application\nName=Fixture\nExec=true\nIcon={icon}\n")

    def test_icon_installed_after_first_lookup_appears_without_restarting(self):
        self.assertEqual(self.call("cachedIcon").stdout.strip(), "")
        self.entry("luna-late-icon")
        self.wait_state(lambda state: state["names"] == ["Fixture"] and state["icons"]
                        and not state["icons"][0]["ready"])
        (self.icons / "luna-late-icon.svg").write_text(SVG)
        self.assertEqual(self.call("reopen").returncode, 0)
        self.wait_state(lambda state: state["icons"] and state["icons"][0]["ready"])

    def test_new_desktop_entry_and_changed_icon_update_the_open_menu(self):
        (self.icons / "first.svg").write_text(SVG)
        self.entry("first")
        self.wait_state(lambda state: state["names"] == ["Fixture"] and state["icons"]
                        and state["icons"][0]["ready"])
        # An existing DesktopEntry can change its icon without changing the app list.
        (self.icons / "second.svg").write_text(SVG.replace("red", "blue"))
        self.entry("second")
        self.wait_state(lambda state: state["icons"] and state["icons"][0]["ready"]
                        and "second.svg" in state["icons"][0]["source"])

    def test_absolute_icon_paths_recover_from_missing_replaced_and_removed_files(self):
        icon = self.root / "icon #? ' %.svg"
        self.entry(str(icon))
        self.wait_state(lambda state: state["icons"] and not state["icons"][0]["ready"])
        icon.write_text(SVG)
        self.assertEqual(self.call("reopen").returncode, 0)
        first = self.wait_state(lambda state: state["icons"] and state["icons"][0]["ready"])
        icon.write_text(SVG.replace("red", "blue"))
        self.assertEqual(self.call("reopen").returncode, 0)
        self.wait_state(lambda state: state["icons"] and state["icons"][0]["ready"]
                        and state["icons"][0]["source"] != first["icons"][0]["source"])
        icon.unlink()
        self.assertEqual(self.call("reopen").returncode, 0)
        self.wait_state(lambda state: state["icons"] and not state["icons"][0]["ready"])

    def test_theme_inheritance_and_system_data_icons(self):
        theme = self.root / "data/icons/hicolor/index.theme"
        theme.write_text(theme.read_text().replace("Name=Hicolor", "Name=Hicolor\nInherits=fixture-parent"))
        parent = self.root / "system-data/icons/fixture-parent"
        (parent / "scalable/apps").mkdir(parents=True)
        (parent / "index.theme").write_text(
            "[Icon Theme]\nName=Parent\nDirectories=scalable/apps\n"
            "[scalable/apps]\nSize=32\nType=Scalable\nMinSize=1\nMaxSize=512\nContext=Applications\n")
        icon = parent / "scalable/apps/inherited.svg"
        icon.write_text(SVG)
        self.entry("inherited")
        self.wait_state(lambda state: state["icons"] and state["icons"][0]["ready"]
                        and "fixture-parent" in state["icons"][0]["source"])

    def test_icon_lookup_uses_system_python_when_path_python_has_no_gtk(self):
        interpreter = self.root / "bin/python3"
        interpreter.write_text('#!/bin/sh\necho "No module named gi" >&2\nexit 1\n')
        interpreter.chmod(0o755)
        (self.icons / "system-python.svg").write_text(SVG)
        self.entry("system-python")
        self.wait_state(lambda state: state["icons"] and state["icons"][0]["ready"])

    def test_failed_lookup_recovers_on_next_open(self):
        helper = self.root / "menu/application_icons.py"
        original = helper.read_text()
        helper.write_text('raise RuntimeError("fixture lookup failure")\n')
        (self.icons / "recover.svg").write_text(SVG)
        self.entry("recover")
        self.wait_state(lambda state: state["icons"] and not state["icons"][0]["ready"]
                        and "Luna menu icon lookup failed" in self.log_path.read_text())
        helper.write_text(original)
        self.assertEqual(self.call("reopen").returncode, 0)
        self.wait_state(lambda state: state["icons"] and state["icons"][0]["ready"])


if __name__ == "__main__":
    unittest.main()
