"""Run an isolated greeter with fake SDDM models; no host login or power calls."""

import json
import os
from pathlib import Path
import pty
import shutil
import struct
import subprocess
import tempfile
import unittest
import zlib


APP = Path(__file__).resolve().parents[1]
RUNNER = os.environ.get("QMLTESTRUNNER") or next((str(path) for path in (
    Path("/usr/lib/qt6/bin/qmltestrunner"), Path("/usr/lib64/qt6/bin/qmltestrunner")
) if path.is_file()), shutil.which("qmltestrunner6"))
QML_PATHS = [Path(value) for value in os.environ.get("QML_IMPORT_PATH", "").split(os.pathsep) if value]
QML_PATHS += [Path("/usr/lib/qt6/qml"), Path("/usr/lib64/qt6/qml")]
HAS_MULTIMEDIA = any((path / "QtMultimedia/qmldir").is_file() for path in QML_PATHS)


def png_chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


@unittest.skipUnless(RUNNER, "Qt 6 qmltestrunner is required (set QMLTESTRUNNER)")
class GreeterTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="luna-login-qml-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.bundle = self.root / "bundle"
        shutil.copytree(APP / "src/greeter", self.bundle)
        shutil.copytree(APP / "src/screens/default", self.bundle / "screen")
        self.assets = self.bundle / "assets"
        self.assets.mkdir()
        (self.assets / "image.png").write_bytes(
            b"\x89PNG\r\n\x1a\n"
            + png_chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
            + png_chunk(b"IDAT", zlib.compress(b"\x00\x40\x80\xff"))
            + png_chunk(b"IEND", b"")
        )
        # Two 1x1 frames keep animated-image coverage independent of FFmpeg.
        (self.assets / "animated.gif").write_bytes(bytes.fromhex(
            "47494638396101000100800000000000ffffff"
            "21ff0b4e45545343415045322e300301000000"
            "21f904000a0000002c0000000001000100000202440100"
            "21f904000a0000002c00000000010001000002024c01003b"
        ))
        settings = {
            "screen": {"name": "default"},
            "wallpaper": {"source": "", "type": "image", "fit": "fill", "background_color": "#000000"},
            "colors": {
                "accent": "#7aa2f7", "accent_foreground": "#15161e",
                "foreground": "#c0caf5", "bright_foreground": "#ffffff",
                "background": "#1a1b26", "lighter_background": "#24283b",
                "darker_background": "#14151f",
                "muted": "#565f89", "comment": "#565f89", "error": "#f7768e",
                "selection": "#283457", "selection_foreground": "#ffffff", "warning": "#e0af68",
            },
            "fonts": {"ui": "sans-serif", "mono": "monospace"},
                "appearance": {"rounding": 16, "border_width": 1,
                               "blur": {"enabled": False, "size": 8, "passes": 3},
                               "opacity": {"active": 0.9, "inactive": 0.85}},
        }
        (self.bundle / "Settings.js").write_text(".pragma library\nvar values = " + json.dumps(settings) + ";\n")
        runtime = self.root / "runtime"
        runtime.mkdir(mode=0o700)
        self.env = dict(os.environ, QT_QPA_PLATFORM="offscreen", QSG_RHI_BACKEND="software",
                        XDG_RUNTIME_DIR=str(runtime), XDG_CONFIG_HOME=str(self.root / "config"),
                        XDG_CACHE_HOME=str(self.root / "cache"), HOME=str(self.root / "home"))
        for name in ("WAYLAND_DISPLAY", "DISPLAY"):
            self.env.pop(name, None)

    def run_qml(self, fixture):
        tests = self.root / "tests"
        tests.mkdir()
        for name in (fixture, "MockBackend.qml"):
            shutil.copyfile(APP / "tests/fixtures" / name, tests / name)
        result = subprocess.run([RUNNER, "-input", str(tests)], env=self.env,
                                text=True, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for line in result.stdout.splitlines():
            if "QWARN" in line and not any(expected in line for expected in (
                "Failed to connect to pipewire", "PulseAudioService: pa_context_connect() failed"
            )):
                self.fail(result.stdout + result.stderr)

    def test_login_screen(self):
        self.run_qml("tst_login.qml")

    @unittest.skipUnless(HAS_MULTIMEDIA and shutil.which("ffmpeg"), "Qt 6 Multimedia and FFmpeg required")
    def test_video_background(self):
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=64x48:r=10",
                        "-t", "0.3", "-c:v", "mpeg4", str(self.assets / "video.mp4")],
                       env=self.env, text=True, capture_output=True, check=True, timeout=15)
        self.run_qml("tst_video.qml")

    @unittest.skipUnless(shutil.which("sddm-greeter-qt6"), "SDDM Qt 6 greeter required")
    def test_sddm_test_mode_loads_bundle(self):
        # SDDM test mode supplies its real models without a daemon socket. The
        # timeout closes this offscreen window after checking startup diagnostics.
        # SDDM's message handler sends diagnostics to the journal without a TTY.
        master, slave = pty.openpty()
        try:
            process = subprocess.Popen(["sddm-greeter-qt6", "--test-mode", "--theme", str(self.bundle)],
                                       env=self.env, stdout=slave, stderr=slave)
        finally:
            os.close(slave)
        try:
            with self.assertRaises(subprocess.TimeoutExpired):
                process.wait(timeout=1)
        finally:
            process.terminate()
            process.wait(timeout=5)
        output = []
        try:
            while chunk := os.read(master, 65536):
                output.append(chunk)
        except OSError:
            pass  # Linux PTYs report EIO after the slave closes.
        finally:
            os.close(master)
        text = b"".join(output).decode(errors="replace")
        self.assertIn("Main.qml", text)
        for failure in ("is not installed", "ReferenceError", "TypeError", "is not a type", "Cannot assign"):
            self.assertNotIn(failure, text)


if __name__ == "__main__":
    unittest.main()
