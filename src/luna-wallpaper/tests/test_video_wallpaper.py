"""Test the real video controller against a private fake mpvpaper Unix socket.

No compositor or real player is launched. These tests check ownership, arguments,
readiness, pause commands, and failures, rather than video quality.
"""

import json
import os
from pathlib import Path
import shutil
import sys
import textwrap
import unittest

from _support import APP, Harness


@unittest.skipUnless(shutil.which("qs"), "Quickshell required")
class VideoWallpaperTests(Harness, unittest.TestCase):
    def setUp(self):
        self.prepare(prefix="luna-v-")
        for name in ("VideoWallpaper.qml", "Video.js"):
            shutil.copyfile(APP / "src/shell" / name, self.renderer / name)
        (self.renderer / "shell.qml").write_text('''import QtQuick
import Quickshell
import Quickshell.Io
ShellRoot {
    id: shell
    property string failure: ""
    property var video: player.item
    Loader { id: player; active: false }
    IpcHandler {
        target: "test"
        function state(): string {
            return JSON.stringify({status: video ? video.status : "absent", error: failure,
                directory: video ? video.privateDirectory : "",
                diagnostic: video ? video.lastPlayerError : "",
                connected: video ? video.connectedOnce : false});
        }
        function start(path: string, fit: string): void {
            failure = "";
            player.active = true;
            player.setSource("VideoWallpaper.qml", {sourcePath: path, outputName: "DP-1",
                fit: fit, startupTimeout: 1600});
            player.item.failed.connect(function(message) { failure = message; });
        }
        function pause(value: bool): void { video.paused = value; }
        function destroy(): void { player.active = false; }
    }
}
''')
        tools = self.root / "bin"
        tools.mkdir()
        fake = tools / "mpvpaper"
        fake.write_text(textwrap.dedent('''\
            #!/usr/bin/python3
            import json, os, pathlib, socket, sys, time
            root = pathlib.Path(os.environ["TEST_VIDEO_ROOT"])
            with (root / "launches").open("a") as file:
                file.write(json.dumps({"args": sys.argv[1:], "pid": os.getpid(),
                    "cwd": os.getcwd(), "home": os.environ["HOME"]}) + "\\n")
            if (root / "crash").exists(): sys.exit(3)
            server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            server.bind("ipc")
            server.listen(1)
            client, _ = server.accept()
            client.settimeout(0.05)
            data = b""
            announced = False
            while True:
                if (root / "disconnect").exists():
                    client.close()
                    time.sleep(10)
                if (root / "event").exists():
                    client.sendall((root / "event").read_bytes() + b"\\n")
                    (root / "event").unlink()
                if not announced and not (root / "hold").exists():
                    client.sendall(json.dumps({"event": "property-change", "name": "video-out-params",
                        "data": {"w": 3840, "h": 2160}}).encode() + b"\\n")
                    announced = True
                try: chunk = client.recv(4096)
                except socket.timeout: continue
                if not chunk: break
                data += chunk
                while b"\\n" in data:
                    line, data = data.split(b"\\n", 1)
                    message = json.loads(line)
                    with (root / "commands").open("a") as file:
                        file.write(json.dumps(message) + "\\n")
                    result = {"request_id": message["request_id"], "error": "success"}
                    if message["command"][:1] == ["get_property"]:
                        result["data"] = None if (root / "hold").exists() else {"w": 3840, "h": 2160}
                    client.sendall(json.dumps(result).encode() + b"\\n")
        '''))
        fake.chmod(0o755)
        self.env["PATH"] = str(tools) + os.pathsep + os.environ["PATH"]
        self.env["TEST_VIDEO_ROOT"] = str(self.root)
        self.launch()

    def rows(self, name):
        path = self.root / name
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def start(self, fit="fill"):
        source = str(self.root / 'wallpaper with spaces;$(touch forbidden).mp4')
        self.ipc("start", source, fit)
        return source

    def test_readiness_requires_decoded_video_and_arguments_stay_literal(self):
        (self.root / "hold").touch()
        source = self.start()
        self.until(lambda: self.state()["connected"])
        self.assertEqual(self.state()["status"], "loading")
        launch = self.rows("launches")[0]
        self.assertEqual(launch["args"][-2:], ["DP-1", source])
        self.assertEqual(launch["args"][:2], ["--layer", "bottom"])
        options = launch["args"][3]
        for option in ("config=no", "load-scripts=no", "loop-file=inf", "audio=no", "hwdec=auto"):
            self.assertIn(option, options)
        self.assertNotIn("fps=", options)
        self.assertNotIn("vf=", options)
        self.assertEqual(launch["cwd"], launch["home"])
        self.assertEqual(Path(launch["cwd"]).stat().st_mode & 0o777, 0o700)
        (self.root / "hold").unlink()
        self.until(lambda: self.state()["status"] == "ready")
        self.assertFalse((self.root / "forbidden").exists())

    def test_pause_commands_and_destruction_release_owned_player(self):
        self.start()
        self.until(lambda: self.state()["status"] == "ready")
        directory = Path(self.state()["directory"])
        pid = self.rows("launches")[0]["pid"]
        for value in (True, False):
            self.ipc("pause", value)
            self.until(lambda: any(row["command"] == ["set_property", "pause", value]
                                   for row in self.rows("commands")))
        self.ipc("destroy")
        self.until(lambda: not directory.exists())
        self.until(lambda: not Path(f"/proc/{pid}").exists())
        self.assertEqual(self.state()["status"], "absent")
        self.assertEqual(self.state()["error"], "")

    def test_decoder_diagnostics_allow_recovery_and_keep_bounded_context(self):
        (self.root / "hold").touch()
        self.start()
        self.until(lambda: self.state()["connected"])

        def diagnostic(level, message):
            (self.root / "event").write_text(json.dumps({
                "event": "log-message", "level": level, "text": message}))
            self.until(lambda: self.state()["diagnostic"] == message[-600:].strip())
            self.assertEqual(self.state()["error"], "")

        diagnostic("error", "Recoverable hardware decoder error")
        self.assertEqual(self.state()["status"], "loading")
        (self.root / "hold").unlink()
        self.until(lambda: self.state()["status"] == "ready")
        diagnostic("fatal", "Recoverable decoder context: " + "x" * 900)
        self.assertEqual(self.state()["status"], "ready")

    def test_video_runtime_helpers_are_resolved_from_path(self):
        for name in ("mktemp", "rm"):
            executable = shutil.which(name)
            self.assertIsNotNone(executable)
            helper = self.root / "bin" / name
            helper.write_text(
                "#!" + sys.executable + "\n"
                "import os, pathlib, sys\n"
                "root = pathlib.Path(os.environ['TEST_VIDEO_ROOT'])\n"
                "with (root / 'helpers').open('a') as output:\n"
                "    output.write(" + repr(name + "\n") + ")\n"
                "os.execv(" + repr(executable) + ", [" + repr(executable) + ", *sys.argv[1:]])\n"
            )
            helper.chmod(0o755)

        self.start()
        self.until(lambda: self.state()["status"] == "ready")
        directory = Path(self.state()["directory"])
        self.ipc("destroy")
        self.until(lambda: not directory.exists())
        self.assertEqual((self.root / "helpers").read_text().splitlines(), ["mktemp", "rm"])

    def test_fit_modes_select_expected_player_options(self):
        for fit, expected in (("fit", "panscan=0"), ("stretch", "keepaspect=no"),
                              ("center", "video-unscaled=yes"), ("tile", "video-unscaled=yes"),
                              ("unknown", "panscan=1")):
            with self.subTest(fit=fit):
                self.start(fit)
                self.until(lambda: self.state()["status"] == "ready")
                self.assertIn(expected, self.rows("launches")[-1]["args"][3])
                directory = Path(self.state()["directory"])
                self.ipc("destroy")
                self.until(lambda: not directory.exists())

    def test_startup_timeout_and_early_crash_report_failure_and_cleanup(self):
        for marker, expected in (("hold", "timeout"), ("crash", "exited (3)")):
            with self.subTest(failure=marker):
                (self.root / marker).touch()
                self.start()
                self.until(lambda: self.state()["status"] == "error")
                self.assertIn(expected, self.state()["error"])
                self.until(lambda: not self.state()["directory"])
                self.ipc("destroy")
                (self.root / marker).unlink()

    def test_socket_disconnect_and_bad_ipc_fail_after_ready(self):
        for failure in ("disconnect", "bad-ipc", "decode"):
            with self.subTest(failure=failure):
                self.start()
                self.until(lambda: self.state()["status"] == "ready")
                directory = Path(self.state()["directory"])
                if failure == "disconnect":
                    (self.root / "disconnect").touch()
                elif failure == "bad-ipc":
                    (self.root / "event").write_text("not json")
                else:
                    (self.root / "event").write_text(json.dumps({
                        "event": "end-file", "reason": "error", "error": "decode failed"}))
                self.until(lambda: self.state()["status"] == "error")
                self.assertTrue(self.state()["error"])
                self.until(lambda: not directory.exists())
                self.ipc("destroy")
                (self.root / "disconnect").unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
