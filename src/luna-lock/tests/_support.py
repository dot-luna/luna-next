"""Private offscreen lock renderer; no live compositor or authentication access."""

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
        self.temporary = tempfile.TemporaryDirectory(prefix="luna-lock ' ")
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
                        DBUS_SYSTEM_BUS_ADDRESS="unix:path=/nonexistent-lock-system-bus",
                        DBUS_SESSION_BUS_ADDRESS="unix:path=/nonexistent-lock-session-bus",
                        LUNA_LOCK_SETTINGS="{}", LUNA_LOCK_THEME=json.dumps(THEME))
        for name in ("WAYLAND_DISPLAY", "DISPLAY", "HYPRLAND_INSTANCE_SIGNATURE", "QT_LOGGING_RULES",
                     "QML_IMPORT_PATH", "QML2_IMPORT_PATH", "LD_LIBRARY_PATH", "LD_PRELOAD"):
            self.env.pop(name, None)
        recorder = self.root / "record API"
        recorder.write_text('''#!/usr/bin/python3
import json, pathlib, sys, time
root = pathlib.Path(__file__).parent
arguments = sys.argv[1:]
def record(event):
    with (root / "requests.jsonl").open("a") as output:
        output.write(json.dumps({"event": event, "arguments": arguments}) + "\\n")
record("start")
if arguments[-2:] == ["display", "off"] and (root / "block-off").exists():
    deadline = time.monotonic() + 8
    while not (root / "release-off").exists() and time.monotonic() < deadline:
        time.sleep(0.02)
record("finish")
if (root / "fail-display").exists() and arguments[-2] == "display":
    sys.exit(1)
''')
        recorder.chmod(0o755)
        self.command = [str(recorder), "lock", "--config", str(self.root / "settings ' $.jsonc")]
        self.env["LUNA_LOCK_COMMAND"] = json.dumps(self.command)
        self.renderer = self.root / "app/src/shell"
        self.renderer.parent.mkdir(parents=True)
        shutil.copytree(SHELL, self.renderer)
        # Keep the controller, PAM outcome handling, power queue, and view real.
        # Replace only native compositor and authentication interfaces.
        surface = self.renderer / "LockSurface.qml"
        surface.write_text(surface.read_text().replace("WlSessionLockSurface {", "FloatingWindow {\n    implicitWidth: 800\n    implicitHeight: 600\n    visible: true", 1)
                           .replace("import Quickshell.Wayland", "import Quickshell\nimport Quickshell.Wayland"))
        shell = self.renderer / "shell.qml"
        shell.write_text(shell.read_text().replace("    IdleMonitor {", "    MockIdleMonitor {")
                         .replace("    WlSessionLock {", "    MockSessionLock {", 1))
        authentication = self.renderer / "Authenticator.qml"
        authentication.write_text(authentication.read_text().replace("PamContext {", "MockPamContext {", 1))
        (self.renderer / "MockIdleMonitor.qml").write_text('''import QtQuick
QtObject {
    property bool enabled: false
    property real timeout: 0
    property bool respectInhibitors: false
    property bool isIdle: false
    onEnabledChanged: if (!enabled) isIdle = false
}
''')
        (self.renderer / "MockSessionLock.qml").write_text('''import QtQuick
QtObject {
    id: session
    default property Component surface
    property bool locked: false
    property bool secure: false
    property bool autoSecure: true
    property int unlockCalls: 0
    property var instance: holder.item
    property Connections changes: Connections {
        target: session
        function onLockedChanged() {
            if (!session.locked) session.secure = false;
            else if (session.autoSecure) session.secure = true;
        }
    }
    property Loader holder: Loader {
        active: session.locked
        sourceComponent: session.surface
    }
    function unlock() {
        unlockCalls++;
        locked = false;
        secure = false;
    }
}
''')
        (self.renderer / "MockPamContext.qml").write_text('''import QtQuick
QtObject {
    property string config: ""
    property bool active: false
    property string message: "Password: "
    property bool messageIsError: false
    property bool responseRequired: false
    property bool responseVisible: false
    property bool startSucceeds: true
    property int startCalls: 0
    property int abortCalls: 0
    property var responseLengths: []
    signal completed(int result)
    signal error(int error)
    signal pamMessage()
    function start() {
        startCalls++;
        active = startSucceeds;
        responseRequired = startSucceeds;
        return startSucceeds;
    }
    function respond(response) {
        responseLengths = responseLengths.concat([response.length]);
        responseRequired = false;
    }
    function abort() {
        abortCalls++;
        active = false;
        responseRequired = false;
    }
    function finish(result) {
        active = false;
        responseRequired = false;
        completed(result);
    }
    function fail() {
        active = false;
        responseRequired = false;
        error(0);
    }
}
''')
        self.process = None
        self.log_path = self.root / "shell.log"
        self.addCleanup(self.stop)

    def append_shell(self, source):
        shell = self.renderer / "shell.qml"
        shell.write_text(shell.read_text().rstrip()[:-1] + source + "}\n")

    def ipc(self, target, method, *arguments, check=True):
        result = subprocess.run([QUICKSHELL, "ipc", "-p", str(self.renderer), "call", "--", target,
                                 method, *arguments], env=self.env, capture_output=True,
                                text=True, timeout=3)
        if check:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr + self.logs())
        return result

    def call(self, target, method, *arguments):
        return self.ipc(target, method, *arguments).stdout.strip()

    def state(self):
        return json.loads(self.call("test", "state"))

    def requests(self):
        path = self.root / "requests.jsonl"
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

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
        self.fail("Lock condition failed:\n" + self.logs())

    def launch(self):
        self.log = self.log_path.open("w")
        self.process = subprocess.Popen([QUICKSHELL, "--no-color", "-p", str(self.renderer)],
                                        env=self.env, cwd=self.root, stdout=self.log,
                                        stderr=subprocess.STDOUT, start_new_session=True)
        self.until(lambda: self.ipc("lock", "status", check=False).stdout.strip() == "idle")

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
