"""Exercise API-validated JSONC snapshots in an isolated offscreen renderer.

Run: python3 -m unittest discover -s src/luna-wallpaper/tests -v
Video rendering is stubbed here; its controller has separate tests.
These tests do not verify Wayland layer placement.
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

from _support import APP, BUN, Harness


# Inserted into a disposable copy only; inspect media ownership without a GUI.
INSPECTOR = '''
    IpcHandler {
        target: "test"
        property var knownImages: []
        function state(): string {
            const images = [], videos = [], seen = [];
            function visit(item) {
                if (!item || seen.indexOf(item) !== -1) return;
                seen.push(item);
                if (item.objectName === "fake-video") videos.push({source: item.sourcePath});
                if (item.source !== undefined && item.sourceSize !== undefined) {
                    if (knownImages.indexOf(item) === -1) knownImages.push(item);
                    images.push({id: knownImages.indexOf(item), source: String(item.source), status: item.status,
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
            return JSON.stringify({settings: shell.wallpaperSettings, settingsStatus: shell.settingsStatus,
                renderSettings: surface.settings, status: surface.mediaStatus, kind: surface.kind,
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
        function decodeError(): void { surface.decoded(surface.currentImage, Image.Error); }
    }
'''


@unittest.skipUnless(shutil.which("qs") and shutil.which("ffprobe") and BUN,
                     "Quickshell, FFmpeg, and Bun required")
class WallpaperShellTests(Harness, unittest.TestCase):
    def setUp(self):
        self.prepare(prefix="luna wallpaper ' ")
        self.renderer = self.root / "src/shell"
        shutil.copytree(APP / "src", self.renderer.parent, dirs_exist_ok=True)
        self.config = Path(self.env["XDG_CONFIG_HOME"]) / "luna/wallpaper.jsonc"
        self.config.parent.mkdir(parents=True)
        shutil.copyfile(APP / "example.jsonc", self.config)
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
    function load(path) {
        sourcePath = path;
        status = "loading";
        Qt.callLater(function () {
            if (sourcePath.endsWith("broken-video.mp4")) {
                status = "error";
                failed("Fake video decoding failure");
            } else {
                status = "ready";
            }
        });
    }
    signal failed(string message)
    Component.onCompleted: load(sourcePath)
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

    def write_config(self, source=None, fit="fit", playback=None, transition=None):
        source = self.image if source is None else source
        settings = {"wallpaper": {"source": str(source), "fit": fit,
                                  "background_color": "#102030"}}
        if playback is not None:
            settings["playback"] = playback
        if transition is not None:
            settings["transition"] = transition
        self.config.parent.mkdir(parents=True, exist_ok=True)
        self.config.write_text("// Renderer test settings\n" + json.dumps(settings) + "\n")

    def settings_snapshot(self):
        return subprocess.run(
            [BUN, "run", str(APP / "tests/settings.ts"), str(self.config)],
            env=self.env, capture_output=True, text=True, check=True, timeout=10,
        ).stdout

    def start(self, cwd=None, snapshot=None):
        self.env["LUNA_WALLPAPER_SETTINGS"] = self.settings_snapshot() if snapshot is None else snapshot
        self.launch(cwd=cwd)
        self.until(lambda: self.state()["settingsStatus"] in ("ready", "error"))
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

    def renderer_snapshot(self):
        result = subprocess.run(["qs", "ipc", "-p", str(self.renderer), "call", "wallpaper", "snapshot"],
                                env=self.env, text=True, capture_output=True, timeout=3, check=True)
        return json.loads(result.stdout)

    def test_public_status_reports_ready_and_snapshot_or_media_errors(self):
        self.write_config()
        self.assertEqual(self.start()["status"], "ready")
        self.assertEqual(self.renderer_status(), "ready")

        state = self.start(snapshot="invalid JSON")
        self.assertEqual(state["settingsStatus"], "error")
        self.assertIsNone(state["settings"])
        self.assert_dark(state)
        self.assertEqual(self.renderer_status(), "error")

        self.write_config(source=self.root / "missing-image.png")
        self.assertEqual(self.start()["status"], "error")
        self.assertEqual(self.renderer_status(), "error")

    def test_jsonc_snapshot_preserves_sparse_unknown_settings_and_source(self):
        self.write_config(playback={"pause_when_output_inactive": True})
        document = json.loads(self.config.read_text().split("\n", 1)[1])
        document["future"] = {"values": [1, 2]}
        original = "// Keep the author's formatting\n" + json.dumps(document, indent=4) + "\n"
        self.config.write_text(original)
        state = self.start()
        self.assertEqual(state["settingsStatus"], "ready")
        self.assertEqual(state["status"], "ready")
        self.assertEqual(state["settings"], document)
        self.assertEqual(state["kind"], "image")
        self.assertEqual(len(state["images"]), 1)
        self.assertEqual((state["images"][0]["width"], state["images"][0]["height"]), (1600, 900))
        self.assertIn("%23%3F.png", state["images"][0]["source"])
        self.assertEqual(state["videos"], [])
        self.assertEqual(self.config.read_text(), original)

    def test_renderer_uses_snapshot_after_source_is_removed_from_an_unrelated_directory(self):
        self.write_config()
        snapshot = self.settings_snapshot()
        self.config.unlink()
        unrelated = self.root / "unrelated working directory"
        unrelated.mkdir()
        state = self.start(cwd=unrelated, snapshot=snapshot)
        self.assertEqual(state["status"], "ready")
        self.assertEqual(state["settings"]["wallpaper"]["source"], str(self.image))
        self.assertFalse(self.config.exists())

    def test_settings_are_loaded_once_even_when_file_changes(self):
        self.write_config()
        first = self.start()
        self.write_config(source="")
        time.sleep(0.3)
        latest = self.state()
        self.assertEqual(latest["settings"], first["settings"])
        self.assertEqual(self.renderer_snapshot(), first["settings"])
        self.assertEqual(latest["status"], first["status"])
        self.assertEqual(latest["images"][0]["source"], first["images"][0]["source"])

    def reload(self, snapshot=None):
        snapshot = self.settings_snapshot() if snapshot is None else snapshot
        return subprocess.run(
            ["qs", "ipc", "-p", str(self.renderer), "call", "wallpaper", "reload", snapshot],
            env=self.env, capture_output=True, text=True, check=True, timeout=3,
        ).stdout.strip()

    def test_explicit_reload_applies_snapshot_without_recreating_media(self):
        self.write_config()
        first = self.start()
        pid = self.process.pid
        self.write_config(fit="center", playback={"pause_when_output_inactive": False},
                          transition={"duration_ms": 750})
        original = self.config.read_bytes()
        self.assertEqual(self.reload(), "ok")
        self.until(lambda: self.renderer_status() == "ready")
        latest = self.state()
        self.assertEqual(self.process.pid, pid)
        self.assertEqual(latest["images"][0]["id"], first["images"][0]["id"])
        self.assertEqual(latest["images"][0]["fillMode"], latest["fillModes"]["center"])
        self.assertEqual(latest["fadeDuration"], 750)
        self.assertFalse(latest["settings"]["playback"]["pause_when_output_inactive"])
        self.assertEqual(self.config.read_bytes(), original)

    def test_malformed_reload_keeps_the_previous_settings_and_media(self):
        self.write_config()
        first = self.start()
        self.assertTrue(self.reload(snapshot="invalid JSON").startswith("error: "))
        latest = self.state()
        self.assertEqual(latest["settings"], first["settings"])
        self.assertEqual(latest["images"][0]["id"], first["images"][0]["id"])
        self.assertEqual(self.renderer_status(), "ready")

    def test_media_reload_retains_the_current_image_until_the_replacement_decodes(self):
        replacement = self.root / "replacement.png"
        self.png(replacement)
        tools = self.root / "bin"
        tools.mkdir()
        probe = tools / "ffprobe"
        probe.write_text('#!/usr/bin/python3\nimport json, pathlib, sys, time\n'
                         'source = pathlib.Path(sys.argv[-1])\n'
                         'if source.name == "replacement.png":\n'
                         '    source.with_suffix(".waiting").touch()\n'
                         '    while not source.with_suffix(".release").exists(): time.sleep(0.01)\n'
                         'print(json.dumps({"streams": [{"codec_name": "png"}], "format": {"format_name": "png_pipe"}}))\n')
        probe.chmod(0o755)
        self.env["PATH"] = str(tools) + ":" + self.env["PATH"]
        self.write_config(transition={"duration_ms": 500})
        first = self.start()
        self.write_config(source=replacement, transition={"duration_ms": 500})
        self.assertEqual(self.reload(), "ok")
        self.until(lambda: replacement.with_suffix(".waiting").exists())
        pending = self.state()
        self.assertEqual(pending["status"], "loading")
        self.assertTrue(pending["visible"])
        self.assertEqual(pending["images"][0]["id"], first["images"][0]["id"])
        self.assertEqual(pending["images"][0]["source"], first["images"][0]["source"])
        self.assertEqual(pending["images"][0]["opacity"], 1)
        replacement.with_suffix(".release").touch()
        self.until(lambda: self.renderer_status() == "ready")
        self.until(lambda: len(self.state()["images"]) == 1)
        latest = self.state()
        self.assertIn("replacement.png", latest["images"][0]["source"])
        self.assertNotEqual(latest["images"][0]["id"], first["images"][0]["id"])

    def test_failed_media_reload_keeps_the_previous_image_and_can_recover(self):
        self.write_config()
        first = self.start()
        self.write_config(source=self.root / "missing.png")
        self.assertEqual(self.reload(), "ok")
        self.until(lambda: self.renderer_status() == "error")
        failed = self.state()
        self.assertTrue(failed["visible"])
        self.assertEqual(failed["images"][0]["id"], first["images"][0]["id"])
        self.write_config()
        self.assertEqual(self.reload(), "ok")
        self.assertEqual(self.renderer_status(), "ready")
        self.assertEqual(self.state()["images"][0]["id"], first["images"][0]["id"])

    def test_reload_switches_between_images_and_videos_in_the_same_shell(self):
        tools = self.root / "bin"
        tools.mkdir()
        probe = tools / "ffprobe"
        probe.write_text('#!/usr/bin/python3\nimport json, sys\n'
                         'video = sys.argv[-1].endswith(".mp4")\n'
                         'print(json.dumps({"streams": [{"codec_name": "h264" if video else "png"}], '
                         '"format": {"format_name": "mov,mp4" if video else "png_pipe"}}))\n')
        probe.chmod(0o755)
        self.env["PATH"] = str(tools) + ":" + self.env["PATH"]
        self.write_config()
        self.start()
        pid = self.process.pid
        for name in ("first.mp4", "second.mp4"):
            video = self.root / name
            self.write_config(source=video)
            self.assertEqual(self.reload(), "ok")
            self.until(lambda: self.renderer_status() == "ready")
            state = self.state()
            self.assertEqual(state["videos"], [{"source": str(video)}])
            self.assertEqual(state["images"], [])
            self.assertEqual(self.process.pid, pid)
        self.write_config()
        self.assertEqual(self.reload(), "ok")
        self.until(lambda: self.renderer_status() == "ready")
        state = self.state()
        self.assertEqual(len(state["images"]), 1)
        self.assertEqual(state["videos"], [])
        self.assertEqual(self.process.pid, pid)
        image_id = state["images"][0]["id"]
        self.write_config(source=self.root / "broken-video.mp4")
        self.assertEqual(self.reload(), "ok")
        self.until(lambda: self.renderer_status() == "error")
        self.assertEqual(self.state()["images"][0]["id"], image_id)
        self.write_config()
        self.assertEqual(self.reload(), "ok")
        self.assertEqual(self.renderer_status(), "ready")
        recovered = self.state()
        self.assertEqual(recovered["kind"], "image")
        self.assertEqual(recovered["images"][0]["id"], image_id)
        self.assertEqual(recovered["videos"], [])

    def test_missing_config_is_created_by_api_and_uses_renderer_defaults(self):
        self.config.unlink()
        self.config.parent.rmdir()
        state = self.start()
        self.assertEqual(state["settingsStatus"], "ready")
        self.assertEqual(state["status"], "ready")
        self.assertEqual(json.loads(self.config.read_text()), {})
        self.assertEqual(state["settings"], {})
        self.assertEqual(state["fadeDuration"], 200)
        self.assert_dark(state)

    def test_example_jsonc_is_a_valid_configured_background(self):
        self.config.write_text(self.config.read_text().replace('"background_color": "#000000"',
                                                             '"background_color": "#102030"'))
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
        self.write_config(source=media, playback={"pause_when_output_inactive": False})
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
        self.assertEqual(state["settingsStatus"], "ready")
        self.assertEqual(state["status"], "error")
        self.assert_dark(state)

    def test_center_and_tile_keep_native_pixels_on_hidpi_outputs(self):
        self.env["QT_SCALE_FACTOR"] = "2"
        for fit in ("center", "tile"):
            with self.subTest(fit=fit):
                self.write_config(fit=fit)
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
                self.write_config(fit=fit)
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
                self.write_config(transition={"type": kind, "duration_ms": duration})
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
