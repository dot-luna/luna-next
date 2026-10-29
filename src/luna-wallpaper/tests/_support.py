"""Private offscreen Quickshell harness; never address a user's running shell."""

import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time


ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / "src/luna-wallpaper"
QML_PATH = os.environ.get("QML_IMPORT_PATH", "")
BUILT_QML = ROOT / "target/hocon-qml/qml"
HAS_CONFIG = (BUILT_QML / "LunaNext/Config/qmldir").exists() or any(
    (Path(path) / "LunaNext/Config/qmldir").exists()
    for path in QML_PATH.split(os.pathsep) if path
)


class Harness:
    def prepare(self, prefix="luna-wallpaper-test-"):
        self.temp = tempfile.TemporaryDirectory(prefix=prefix)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.renderer = self.root / "src"
        self.renderer.mkdir()
        runtime = self.root / "runtime"
        runtime.mkdir(mode=0o700)
        home = self.root / "home"
        home.mkdir()
        self.env = dict(os.environ, QT_QPA_PLATFORM="offscreen", QS_NO_RELOAD_POPUP="1",
                        HOME=str(home), XDG_RUNTIME_DIR=str(runtime),
                        XDG_CONFIG_HOME=str(self.root / "config"),
                        XDG_CACHE_HOME=str(self.root / "cache"),
                        XDG_DATA_HOME=str(self.root / "data"),
                        XDG_STATE_HOME=str(self.root / "state"),
                        DBUS_SYSTEM_BUS_ADDRESS="unix:path=/nonexistent-wallpaper-test-bus")
        for name in ("WAYLAND_DISPLAY", "DISPLAY", "HYPRLAND_INSTANCE_SIGNATURE", "QT_LOGGING_RULES",
                     "LUNA_WALLPAPER_CONFIG"):
            self.env.pop(name, None)
        self.env["QML_IMPORT_PATH"] = os.pathsep.join(filter(None, (str(BUILT_QML), QML_PATH)))
        self.log_path = self.root / "shell.log"
        self.process = None
        self.addCleanup(self.stop)

    def launch(self, cwd=None):
        self.stop()
        self.log = self.log_path.open("w")
        self.process = subprocess.Popen(["qs", "-p", str(self.renderer)], env=self.env,
                                        stdout=self.log, stderr=subprocess.STDOUT,
                                        start_new_session=True, cwd=cwd or self.root)
        self.until(lambda: self.ipc("state", check=False).stdout.startswith("{"))

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

    def ipc(self, method, *arguments, check=True):
        values = [str(value).lower() if isinstance(value, bool) else str(value) for value in arguments]
        return subprocess.run(["qs", "ipc", "-p", str(self.renderer), "call", "test", method, *values],
                              env=self.env, text=True, capture_output=True, timeout=3, check=check)

    def state(self):
        return json.loads(self.ipc("state").stdout)

    def until(self, predicate, timeout=5):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if predicate():
                return
            if self.process is not None and self.process.poll() is not None:
                break
            time.sleep(0.025)
        self.fail("Wallpaper condition failed:\n" + self.log_path.read_text())
