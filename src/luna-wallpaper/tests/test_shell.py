"""Exercise the real HOCON adapter and image renderer in an isolated offscreen shell.

Run: python3 -m unittest discover -s src/luna-wallpaper/tests -v
Build packages/hocon-qml first. Video rendering is stubbed here; its controller
has separate tests. These tests do not verify Wayland layer placement.
"""

import json
from pathlib import Path
import re
import shutil
import struct
import subprocess
import time
import unittest
import zlib

from _support import APP, HAS_CONFIG, Harness


# Inserted into a disposable copy only; application IPC exposes status alone.
INSPECTOR = '''
    IpcHandler {
        target: "test"
        function state(): string {
            const images = [], videos = [], seen = [];
            function visit(item) {
                if (!item || seen.indexOf(item) !== -1) return;
                seen.push(item);
                if (item.objectName === "fake-video") videos.push({source: item.sourcePath});
                if (item.source !== undefined && item.sourceSize !== undefined) {
                    images.push({source: String(item.source), status: item.status,
                        width: item.sourceSize.width, height: item.sourceSize.height,
                        displayWidth: item.width, displayHeight: item.height,
                        scale: item.parent.scale, opacity: item.parent.opacity,
                        fillMode: item.fillMode, smooth: item.smooth,
                        autoTransform: item.autoTransform || false, frameCount: item.frameCount || 0,
                        playing: item.playing || false, paused: item.paused || false,
                        frame: item.currentFrame || 0});
                }
                if (item.contentItem) visit(item.contentItem);
                for (const child of (item.children || [])) visit(child);
            }
            visit(surface);
            return JSON.stringify({path: shell.configPath, config: shell.config, configStatus: shell.configStatus,
                settings: surface.settings, status: surface.mediaStatus, kind: surface.kind,
                images: images, videos: videos, visible: surface.visible,
                fillModes: {fill: Image.PreserveAspectCrop, fit: Image.PreserveAspectFit,
                    stretch: Image.Stretch, center: Image.Pad, tile: Image.Tile},
                fadeDuration: surface.fadeDuration,
                color: String(surface.color), width: surface.width, height: surface.height,
                dpr: surface.screen.devicePixelRatio});
        }
        function outputActive(value: bool): void {
            surface.monitor = {lastIpcObject: {dpmsStatus: value}};
        }
        function decodeError(): void { surface.decoded(Image.Error); }
    }
'''


@unittest.skipUnless(shutil.which("qs") and shutil.which("ffprobe") and HAS_CONFIG,
                     "Quickshell, FFmpeg, and the built LunaNext.Config module required")
class WallpaperShellTests(Harness, unittest.TestCase):
    def setUp(self):
        self.prepare(prefix="luna wallpaper ' ")
        self.renderer = self.root / "src/shell"
        shutil.copytree(APP / "src", self.renderer.parent, dirs_exist_ok=True)
        self.config = Path(self.env["XDG_CONFIG_HOME"]) / "luna-next/wallpaper.conf"
        self.defaults = self.config.parent / "defaults.conf"
        self.config.parent.mkdir(parents=True)
        shutil.copyfile(APP / "example.conf", self.config)
        shutil.copyfile(APP / "tests/fixtures/defaults.conf", self.defaults)
        shell = self.renderer / "shell.qml"
        source = shell.read_text()
        self.assertTrue(source.rstrip().endswith("}"))
        if "import Quickshell.Io" not in source:
            source = "import Quickshell.Io\n" + source
        shell.write_text(source.rstrip()[:-1] + INSPECTOR + "}\n")

        # Offscreen Qt has no Wayland layer shell. Preserve all renderer code.
        surface = self.renderer / "WallpaperSurface.qml"
        source = surface.read_text().replace("PanelWindow {", "FloatingWindow {\n    implicitWidth: 800\n    implicitHeight: 600", 1)
        source = re.sub(r"(?ms)^    anchors \{.*?^    \}", "", source, count=1)
        source = "\n".join(line for line in source.splitlines() if not line.strip().startswith((
            "anchors {", "exclusionMode:", "WlrLayershell.")))
        source, replaced = re.subn(r"readonly property var monitor:.*", "property var monitor: null", source)
        self.assertEqual(replaced, 1)
        surface.write_text(source)
        (self.renderer / "VideoWallpaper.qml").write_text('''import QtQuick
Item {
    objectName: "fake-video"
    property string sourcePath: ""
    property string outputName: ""
    property string fit: ""
    property color backgroundColor: "#000000"
    property bool paused: false
    property string status: "loading"
    signal failed(string message)
    Component.onCompleted: status = "ready"
}
''')
        self.image = self.root / "wallpaper ' #?.png"
        self.png(self.image)

    @staticmethod
    def png(path):
        def chunk(kind, data):
            return struct.pack("!I", len(data)) + kind + data + struct.pack("!I", zlib.crc32(kind + data))
        header = struct.pack("!IIBBBBB", 1600, 900, 8, 2, 0, 0, 0)
        pixels = zlib.compress((b"\x00" + b"\xff\x00\x00" * 1600) * 900)
        path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
                         + chunk(b"IDAT", pixels) + chunk(b"IEND", b""))

    @staticmethod
    def gif(path):
        header = b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff"
        def frame(pixel):
            return (b"\x21\xf9\x04\x00\x05\x00\x00\x00\x2c\x00\x00\x00\x00"
                    b"\x01\x00\x01\x00\x00\x02\x02" + bytes((pixel, 1)) + b"\x00")
        path.write_bytes(header + frame(0x44) + frame(0x4c) + b"\x3b")

    def write_config(self, source=None, extra=""):
        source = self.image if source is None else source
        self.config.parent.mkdir(parents=True, exist_ok=True)
        self.config.write_text('include file("defaults.conf")\nwallpaper {\n  source = '
                               + json.dumps(str(source)) + '\n  fit = "fit"\n'
                               '  background_color = "#102030"\n}\n' + extra)

    def start(self, cwd=None):
        self.launch(cwd=cwd)
        self.until(lambda: self.state()["configStatus"] in ("ready", "error"))
        self.until(lambda: self.state()["status"] in ("ready", "error"))
        return self.state()

    def assert_dark(self, state):
        self.assertTrue(state["visible"])
        self.assertEqual(state["color"], "#000000")
        self.assertEqual(state["images"], [])
        self.assertEqual(state["videos"], [])

    def renderer_status(self):
        result = subprocess.run(["qs", "ipc", "-p", str(self.renderer), "call", "wallpaper", "status"],
                                env=self.env, text=True, capture_output=True, timeout=3, check=True)
        return result.stdout.strip()

    def test_public_status_reports_ready_and_configuration_or_media_errors(self):
        self.write_config()
        self.assertEqual(self.start()["status"], "ready")
        self.assertEqual(self.renderer_status(), "ready")

        self.config.write_text("wallpaper.fit = \"banana\"\n")
        self.assertEqual(self.start()["configStatus"], "error")
        self.assertEqual(self.renderer_status(), "error")

        self.write_config(source=self.root / "missing-image.png")
        self.assertEqual(self.start()["status"], "error")
        self.assertEqual(self.renderer_status(), "error")

    def test_hocon_includes_precedence_unknown_settings_and_original_files(self):
        self.defaults.write_text('wallpaper { source = "", fit = "center", background_color = "#ff0000" }\n'
                                 'playback.pause_when_output_inactive = true\nfuture.values = [1, 2]\n')
        self.write_config()
        before = {path: path.read_bytes() for path in (self.config, self.defaults, self.image)}
        state = self.start()
        self.assertEqual(state["configStatus"], "ready")
        self.assertEqual(state["status"], "ready")
        self.assertEqual(state["config"]["wallpaper"]["fit"], "fit")
        self.assertEqual(state["config"]["future"]["values"], [1, 2])
        self.assertTrue(state["config"]["playback"]["pause_when_output_inactive"])
        self.assertEqual(state["kind"], "image")
        self.assertEqual(len(state["images"]), 1)
        self.assertEqual((state["images"][0]["width"], state["images"][0]["height"]), (1600, 900))
        self.assertIn("%23%3F.png", state["images"][0]["source"])
        self.assertEqual(state["videos"], [])
        for path, original in before.items():
            self.assertEqual(path.read_bytes(), original)

    def test_configuration_uses_xdg_user_location_from_an_unrelated_directory(self):
        self.write_config()
        unrelated = self.root / "unrelated working directory"
        unrelated.mkdir()
        # A repository-relative configuration must never take precedence.
        (self.root / "config.conf").write_text("invalid repository-side config {")
        state = self.start(cwd=unrelated)
        self.assertEqual(state["path"], str(self.config))
        self.assertEqual(state["status"], "ready")
        self.assertEqual(state["config"]["wallpaper"]["source"], str(self.image))

    def test_explicit_configuration_path_has_precedence_and_resolves_sibling_includes(self):
        default_path = self.config
        default_path.write_text("invalid default config {")
        self.config = self.root / "custom ' config/wallpaper.conf"
        self.write_config()
        shutil.copyfile(self.defaults, self.config.parent / "defaults.conf")
        self.env["LUNA_WALLPAPER_CONFIG"] = str(self.config)
        state = self.start()
        self.assertEqual(state["path"], str(self.config))
        self.assertEqual(state["status"], "ready")
        self.assertTrue(state["config"]["playback"]["pause_when_output_inactive"])
        self.assertEqual(default_path.read_text(), "invalid default config {")

    def test_empty_explicit_path_falls_back_to_xdg_location(self):
        self.env["LUNA_WALLPAPER_CONFIG"] = ""
        self.write_config()
        state = self.start()
        self.assertEqual(state["path"], str(self.config))
        self.assertEqual(state["status"], "ready")

    def test_empty_or_unset_xdg_base_uses_home_config_directory(self):
        default_path = self.config
        default_path.write_text("invalid xdg config {")
        self.config = Path(self.env["HOME"]) / ".config/luna-next/wallpaper.conf"
        self.write_config()
        shutil.copyfile(self.defaults, self.config.parent / "defaults.conf")
        for value in (None, ""):
            with self.subTest(xdg_config_home=value):
                if value is None:
                    self.env.pop("XDG_CONFIG_HOME", None)
                else:
                    self.env["XDG_CONFIG_HOME"] = value
                state = self.start()
                self.assertEqual(state["path"], str(self.config))
                self.assertEqual(state["status"], "ready")
                self.assertEqual(default_path.read_text(), "invalid xdg config {")
                self.stop()

    def test_config_is_loaded_once_even_when_file_changes(self):
        self.write_config()
        first = self.start()
        self.config.write_text('wallpaper.source = ""\nwallpaper.background_color = "#ffffff"\n')
        time.sleep(0.3)
        latest = self.state()
        self.assertEqual(latest["config"], first["config"])
        self.assertEqual(latest["status"], first["status"])
        self.assertEqual(latest["images"][0]["source"], first["images"][0]["source"])

    def test_missing_config_is_created_and_uses_safe_empty_settings(self):
        self.config.unlink()
        self.defaults.unlink()
        self.config.parent.rmdir()
        state = self.start()
        self.assertEqual(state["configStatus"], "ready")
        self.assertEqual(state["status"], "ready")
        self.assertEqual(self.config.read_text(), "")
        self.assertEqual(state["config"], {})
        self.assert_dark(state)

    def test_invalid_configuration_falls_back_without_rewriting(self):
        for invalid in ('wallpaper {', 'wallpaper.source = 3', 'wallpaper.fit = "unknown"',
                        'wallpaper.background_color = "not-a-color"', 'wallpaper = []',
                        'wallpaper = null', 'playback = false', 'transition = "fade"',
                        'playback.pause_when_output_inactive = "false"',
                        'transition.type = "unknown"', 'transition.duration_ms = -1',
                        'transition.duration_ms = "200"', 'transition.duration_ms = 0.5',
                        'transition.duration_ms = 2147483648', 'transition.duration_ms = null',
                        'wallpaper.background_color = "#12345678"',
                        'wallpaper.background_color = "#123456\\n"'):
            with self.subTest(config=invalid):
                self.config.write_text(invalid)
                state = self.start()
                self.assertEqual(state["configStatus"], "error")
                self.assertIsNone(state["config"])
                self.assert_dark(state)
                self.assertEqual(self.config.read_text(), invalid)
                self.stop()

    def test_invalid_media_paths_are_rejected_before_rendering(self):
        for path in ("relative.png", "~/wallpaper.png", "$HOME/wallpaper.png", "file:///wallpaper.png",
                     "/wallpaper\x00.png", "/wallpaper\x1f.png", "/wallpaper\x7f.png", "/wallpaper.png\n"):
            with self.subTest(path=path):
                source = "wallpaper.source = " + json.dumps(path) + "\n"
                self.config.write_text(source)
                state = self.start()
                self.assertEqual(state["configStatus"], "error")
                self.assertIsNone(state["config"])
                self.assert_dark(state)
                self.assertEqual(self.config.read_text(), source)
                self.assertIn("/wallpaper/source", self.log_path.read_text())
                self.stop()

    def test_schema_accepts_duration_boundaries_and_preserves_optional_unknown_settings(self):
        for duration in (0, 2147483647):
            with self.subTest(duration=duration):
                document = {"wallpaper": {"background_color": "#aBcDeF", "future": None},
                            "playback": {"future": [1, "two"]},
                            "transition": {"duration_ms": duration},
                            "future": {"enabled": True}}
                source = json.dumps(document)
                self.config.write_text(source)
                state = self.start()
                self.assertEqual(state["configStatus"], "ready")
                self.assertEqual(state["config"], document)
                self.assertEqual(state["color"], "#abcdef")
                self.assertEqual(state["fadeDuration"], duration)
                self.assertEqual(state["images"], [])
                self.assertEqual(self.config.read_text(), source)
                self.stop()

    def test_invalid_inherited_settings_report_the_field_without_rewriting(self):
        self.defaults.write_text('wallpaper.fit = "invalid"\n')
        self.config.write_text('include file("defaults.conf")\nwallpaper.source = ""\n')
        before = {path: path.read_bytes() for path in (self.config, self.defaults)}
        state = self.start()
        self.assertEqual(state["configStatus"], "error")
        self.assert_dark(state)
        self.assertIn("/wallpaper/fit", self.log_path.read_text())
        for path, original in before.items():
            self.assertEqual(path.read_bytes(), original)

    def test_unreadable_or_invalid_schema_fails_without_rewriting_config(self):
        schema = self.renderer.parent / "config.schema.json"
        original = self.config.read_bytes()
        schema.unlink()
        for content in (None, '{"type": "not-a-type"}'):
            with self.subTest(schema=content):
                if content is not None:
                    schema.write_text(content)
                state = self.start()
                self.assertEqual(state["configStatus"], "error")
                self.assertIsNone(state["config"])
                self.assert_dark(state)
                self.assertEqual(self.config.read_bytes(), original)
                self.assertIn("config.schema.json", self.log_path.read_text())
                self.stop()

    def test_example_config_is_a_valid_configured_background(self):
        self.config.write_text(self.config.read_text().replace('background_color = "#000000"',
                                                             'background_color = "#102030"'))
        state = self.start()
        self.assertEqual(state["status"], "ready")
        self.assertEqual(state["color"], "#102030")
        self.assertEqual(state["images"], [])
        self.assertEqual(state["videos"], [])

    def test_content_detection_uses_bytes_instead_of_file_extension(self):
        for name, kind in (("still.gif", "image"), ("animation.png", "animated")):
            with self.subTest(name=name):
                media = self.root / name
                self.png(media) if kind == "image" else self.gif(media)
                self.write_config(source=media)
                state = self.start()
                self.assertEqual(state["status"], "ready")
                self.assertEqual(state["kind"], kind)
                self.assertEqual(len(state["images"]), 1)
                self.assertEqual(state["images"][0]["frameCount"], 2 if kind == "animated" else 1)
                self.stop()

    def test_finite_animation_loops_and_pauses_with_output_activity(self):
        media = self.root / "finite.gif"
        self.gif(media)
        self.write_config(source=media)
        self.start()
        time.sleep(0.3)
        self.assertTrue(self.state()["images"][0]["playing"])
        self.ipc("outputActive", False)
        self.until(lambda: self.state()["images"][0]["paused"])
        frame = self.state()["images"][0]["frame"]
        time.sleep(0.15)
        self.assertEqual(self.state()["images"][0]["frame"], frame)
        self.ipc("outputActive", True)
        self.until(lambda: not self.state()["images"][0]["paused"])

    def test_animation_can_keep_playing_on_an_inactive_output(self):
        media = self.root / "finite.gif"
        self.gif(media)
        self.write_config(source=media, extra="playback.pause_when_output_inactive = false\n")
        self.start()
        self.ipc("outputActive", False)
        time.sleep(0.3)
        image = self.state()["images"][0]
        self.assertFalse(image["paused"])
        self.assertTrue(image["playing"])

    def test_video_metadata_routes_to_separate_video_component(self):
        tools = self.root / "bin"
        tools.mkdir()
        probe = tools / "ffprobe"
        probe.write_text('#!/usr/bin/python3\nprint(\'{"streams":[{"codec_name":"h264"}],'
                         '"format":{"format_name":"mov,mp4"}}\')\n')
        probe.chmod(0o755)
        self.env["PATH"] = str(tools) + ":" + self.env["PATH"]
        self.write_config()
        state = self.start()
        self.assertEqual(state["kind"], "video")
        self.assertEqual(state["images"], [])
        self.assertEqual(state["videos"], [{"source": str(self.image)}])

    def test_missing_ffprobe_still_allows_qt_to_decode_images(self):
        tools = self.root / "bin"
        tools.mkdir()
        (tools / "qs").symlink_to(shutil.which("qs"))
        self.env["PATH"] = str(tools)
        self.write_config()
        state = self.start()
        self.assertEqual(state["status"], "ready")
        self.assertEqual(state["kind"], "image")
        self.assertEqual(len(state["images"]), 1)

    def test_corrupt_media_and_late_decode_errors_clear_renderers(self):
        self.write_config()
        self.start()
        self.ipc("decodeError")
        self.until(lambda: self.state()["status"] == "error")
        self.assert_dark(self.state())
        self.stop()
        self.image.write_bytes(b"not an image")
        state = self.start()
        self.assertEqual(state["configStatus"], "ready")
        self.assertEqual(state["status"], "error")
        self.assert_dark(state)

    def test_center_and_tile_keep_native_pixels_on_hidpi_outputs(self):
        self.env["QT_SCALE_FACTOR"] = "2"
        for fit in ("center", "tile"):
            with self.subTest(fit=fit):
                self.write_config()
                self.config.write_text(self.config.read_text().replace('fit = "fit"', 'fit = "' + fit + '"'))
                state = self.start()
                image = state["images"][0]
                self.assertEqual(state["dpr"], 2)
                self.assertEqual(image["scale"] * state["dpr"], 1)
                self.assertEqual(image["displayWidth"] * image["scale"], state["width"])
                self.assertEqual(image["displayHeight"] * image["scale"], state["height"])
                self.assertEqual((image["width"], image["height"]), (1600, 900))
                self.stop()

    def test_all_image_fit_modes_change_presentation_without_downsampling(self):
        for fit in ("fill", "fit", "stretch", "center", "tile"):
            with self.subTest(fit=fit):
                self.write_config()
                self.config.write_text(self.config.read_text().replace('fit = "fit"', 'fit = "' + fit + '"'))
                state = self.start()
                image = state["images"][0]
                self.assertEqual(image["fillMode"], state["fillModes"][fit])
                self.assertEqual(image["smooth"], fit not in ("center", "tile"))
                self.assertTrue(image["autoTransform"])
                self.assertEqual((image["width"], image["height"]), (1600, 900))
                self.stop()

    def test_startup_transition_supports_disabled_zero_and_custom_fades(self):
        for kind, duration in (("none", 2000), ("fade", 0), ("fade", 2000)):
            with self.subTest(kind=kind, duration=duration):
                self.write_config(extra='transition { type = "' + kind + '", duration_ms = '
                                  + str(duration) + ' }\n')
                state = self.start()
                self.assertEqual(state["fadeDuration"], duration if kind == "fade" else 0)
                if kind == "fade" and duration:
                    self.assertLess(state["images"][0]["opacity"], 1)
                    self.until(lambda: self.state()["images"][0]["opacity"] == 1, timeout=3)
                else:
                    self.assertEqual(state["images"][0]["opacity"], 1)
                self.stop()


if __name__ == "__main__":
    unittest.main()
