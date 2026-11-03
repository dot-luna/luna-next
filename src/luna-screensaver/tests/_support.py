"""Private offscreen renderer; never address the user's running shell."""

import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time


APP = Path(__file__).resolve().parents[1]
SHELL = APP / "src/shell"
QUICKSHELL = shutil.which("qs") or shutil.which("quickshell")
THEME = {
    "colors": {"background": "#e1e2e7", "foreground": "#343b58",
               "bright_foreground": "#1a1b26", "accent": "#34548a"},
    "fonts": {"ui": "DejaVu Sans", "mono": "DejaVu Sans Mono"},
}


class Harness:
    def prepare(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="luna-screensaver ' ")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for name in ("runtime", "home", "config", "data", "cache", "state"):
            (self.root / name).mkdir(mode=0o700)
        self.env = dict(os.environ, QT_QPA_PLATFORM="offscreen", QT_QUICK_BACKEND="software",
                        QS_NO_RELOAD_POPUP="1", HOME=str(self.root / "home"),
                        XDG_RUNTIME_DIR=str(self.root / "runtime"),
                        XDG_CONFIG_HOME=str(self.root / "config"),
                        XDG_DATA_HOME=str(self.root / "data"),
                        XDG_CACHE_HOME=str(self.root / "cache"),
                        XDG_STATE_HOME=str(self.root / "state"),
                        DBUS_SYSTEM_BUS_ADDRESS="unix:path=/nonexistent-saver-system-bus",
                        DBUS_SESSION_BUS_ADDRESS="unix:path=/nonexistent-saver-session-bus",
                        LUNA_SCREENSAVER_SETTINGS="{}", LUNA_SCREENSAVER_THEME=json.dumps(THEME))
        for name in ("WAYLAND_DISPLAY", "DISPLAY", "HYPRLAND_INSTANCE_SIGNATURE", "QT_LOGGING_RULES",
                     "QML_IMPORT_PATH", "QML2_IMPORT_PATH", "LD_LIBRARY_PATH", "LD_PRELOAD"):
            self.env.pop(name, None)
        recorder = self.root / "record API"
        recorder.write_text('''#!/usr/bin/python3
import json, pathlib, sys
with pathlib.Path(__file__).with_name("requests.jsonl").open("a") as output:
    output.write(json.dumps(sys.argv[1:]) + "\\n")
''')
        recorder.chmod(0o755)
        self.command = [str(recorder), "screensaver", "--config", str(self.root / "settings ' $.jsonc")]
        self.env["LUNA_SCREENSAVER_COMMAND"] = json.dumps(self.command)
        self.renderer = self.root / "app/src/shell"
        self.renderer.parent.mkdir(parents=True)
        shutil.copytree(SHELL, self.renderer)
        # Offscreen has no layer-shell or idle-notify protocol. Preserve the real
        # renderer and replace only these compositor-owned interfaces.
        surface = self.renderer / "SaverSurface.qml"
        source = surface.read_text().replace("PanelWindow {", "FloatingWindow {\n    implicitWidth: 800\n    implicitHeight: 600", 1)
        surface.write_text("\n".join(line for line in source.splitlines() if not line.strip().startswith(
            ("anchors { top:", "exclusionMode:", "WlrLayershell."))) + "\n")
        shell = self.renderer / "shell.qml"
        shell.write_text(shell.read_text().replace("    IdleMonitor {", "    MockIdleMonitor {", 1))
        (self.renderer / "MockIdleMonitor.qml").write_text('''import QtQuick
QtObject {
    property bool enabled: false
    property real timeout: 0
    property bool respectInhibitors: false
    property bool isIdle: false
    onEnabledChanged: if (!enabled) isIdle = false
}
''')
        self.process = None
        self.log_path = self.root / "shell.log"
        self.addCleanup(self.stop)

    def append_shell(self, source):
        shell = self.renderer / "shell.qml"
        shell.write_text(shell.read_text().rstrip()[:-1] + source + "}\n")

    def ipc(self, target, method, *arguments, check=True):
        result = subprocess.run([QUICKSHELL, "ipc", "-p", str(self.renderer), "call", "--", target, method,
                                 *arguments], env=self.env, capture_output=True, text=True, timeout=3)
        if check:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr + self.logs())
        return result

    def call(self, target, method, *arguments):
        return self.ipc(target, method, *arguments).stdout.strip()

    def state(self):
        return json.loads(self.call("test", "state"))

    def logs(self):
        return self.log_path.read_text() if self.log_path.exists() else ""

    def until(self, predicate, timeout=5):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if predicate():
                return
            if self.process is not None and self.process.poll() is not None:
                break
            time.sleep(0.025)
        self.fail("Screensaver condition failed:\n" + self.logs())

    def launch(self):
        self.log = self.log_path.open("w")
        self.process = subprocess.Popen([QUICKSHELL, "--no-color", "-p", str(self.renderer)],
                                        env=self.env, cwd=self.root, stdout=self.log,
                                        stderr=subprocess.STDOUT, start_new_session=True)
        self.until(lambda: self.ipc("screensaver", "status", check=False).stdout.strip() == "hidden")

    def stop(self):
        if self.process is None:
            return
        try:
            os.killpg(self.process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(self.process.pid, signal.SIGKILL)
            self.process.wait(timeout=5)
        self.log.close()
        self.process = None
