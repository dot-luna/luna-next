import copy
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


APP = Path(__file__).resolve().parents[1]
KITTY = shutil.which("kitty")
PYTHON = shutil.which("python3")


class KittyBuildTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.output = self.root / "output"
        shutil.copytree(APP / "config", self.output)
        self.theme = json.loads((APP / "tests/fixtures/theme.json").read_text())
        self.response = self.root / "theme.json"
        binary = self.root / "bin/lnxt"
        binary.parent.mkdir()
        binary.write_text(
            f"#!{PYTHON}\n"
            "import os, pathlib, sys\n"
            "assert sys.argv[1:] == ['theme', 'get', '--json']\n"
            "sys.stdout.write(pathlib.Path(os.environ['TEST_THEME']).read_text())\n"
            "sys.stderr.write(os.environ.get('TEST_THEME_ERROR', ''))\n"
            "sys.exit(int(os.environ.get('TEST_THEME_STATUS', '0')))\n"
        )
        binary.chmod(0o755)
        self.env = dict(
            os.environ,
            PATH=f"{binary.parent}{os.pathsep}{os.environ['PATH']}",
            HOME=str(self.root / "home"),
            XDG_CONFIG_HOME=str(self.root / "config"),
            XDG_RUNTIME_DIR=str(self.root / "runtime"),
            LUNA_APP_DIR=str(APP),
            LUNA_CONFIG_OUTPUT=str(self.output),
            TEST_THEME=str(self.response),
        )
        self.env.pop("KITTY_CONFIG_DIRECTORY", None)

    def build(self, response=None):
        self.response.write_text(json.dumps(response if response is not None else self.theme))
        return subprocess.run(
            [PYTHON, str(APP / "src/build.py")],
            env=self.env,
            text=True,
            capture_output=True,
        )

    def settings(self):
        lines = (self.output / "generated/theme.conf").read_text().splitlines()
        return dict(line.split(maxsplit=1) for line in lines if line and not line.startswith("#"))

    def test_default_theme_maps_terminal_colors_and_monospace_font(self):
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stderr)
        settings = self.settings()
        self.assertEqual(settings["font_family"], "Iosevka Nerd Font")
        self.assertEqual(settings["background"], "#1a1b26")
        self.assertEqual(settings["foreground"], "#a9b1d6")
        self.assertEqual(settings["selection_background"], "#292e42")
        self.assertEqual(settings["active_tab_background"], "#7aa2f7")
        colors = self.theme["result"]["colors"]
        roles = (
            "dark_background", "error", "success", "warning", "link",
            "secondary_accent", "info", "light_foreground", "dark_foreground",
            "error_emphasis", "success_emphasis", "warning_emphasis", "link_emphasis",
            "secondary_accent_emphasis", "info_emphasis", "bright_foreground",
        )
        self.assertEqual([settings[f"color{i}"] for i in range(16)], [colors[role] for role in roles])

    def test_custom_light_colors_and_font_replace_the_previous_generation(self):
        self.assertEqual(self.build().returncode, 0)
        custom = copy.deepcopy(self.theme)
        custom["result"]["colors"].update(
            mode="light", background="#eeeeee", foreground="#112233", accent="#345678",
            accent_foreground="#ffffff", error_emphasis="#911122", selection="#abc123",
        )
        custom["result"]["fonts"]["mono"] = "Custom Mono Nerd Font"
        result = self.build(custom)
        self.assertEqual(result.returncode, 0, result.stderr)
        settings = self.settings()
        self.assertEqual(settings["font_family"], "Custom Mono Nerd Font")
        self.assertEqual(settings["background"], "#eeeeee")
        self.assertEqual(settings["foreground"], "#112233")
        self.assertEqual(settings["cursor"], "#345678")
        self.assertEqual(settings["cursor_text_color"], "#ffffff")
        self.assertEqual(settings["selection_background"], "#abc123")
        self.assertEqual(settings["color9"], "#911122")

    def test_unresolved_theme_does_not_create_a_generated_file(self):
        self.env.update(TEST_THEME_STATUS="1", TEST_THEME_ERROR="invalid selected theme")
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("invalid selected theme", result.stderr)
        self.assertFalse((self.output / "generated").exists())

    def test_incomplete_or_failed_response_preserves_existing_output(self):
        self.assertEqual(self.build().returncode, 0)
        output = self.output / "generated/theme.conf"
        previous = output.read_bytes()
        incomplete = copy.deepcopy(self.theme)
        del incomplete["result"]["colors"]["foreground"]
        for response in (incomplete, {"ok": False, "error": "theme unavailable"}):
            with self.subTest(response=response):
                self.assertNotEqual(self.build(response).returncode, 0)
                self.assertEqual(output.read_bytes(), previous)

    @unittest.skipUnless(KITTY, "Kitty is required for its native configuration parser")
    def test_native_kitty_parser_loads_include_and_preserves_terminal_behavior(self):
        self.assertEqual(self.build().returncode, 0)
        script = """
import json, sys
from kitty.config import load_config
bad = []
options = load_config(sys.argv[1], accumulate_bad_lines=bad)
assert not bad, bad
assert options.font_size == 14
assert options.cursor_shape == 3
assert options.cursor_blink_interval[0] == 0
assert options.shell_integration == frozenset({'no-cursor'})
assert options.disable_ligatures == 0
assert not options.enable_audio_bell
assert not options.remember_window_size
assert tuple(options.window_padding_width) == (5, 5, 5, 1)
assert options.hide_window_decorations == 1
assert options.confirm_os_window_close[0] == 0
assert options.allow_remote_control == 'socket-only'
assert options.listen_on.endswith('/luna-kitty-{kitty_pid}')
print(json.dumps({'font': str(options.font_family), 'background': int(options.background), 'color14': int(options.color14)}))
"""
        result = subprocess.run(
            [KITTY, "+runpy", script, str(self.output / "kitty.conf")],
            env=self.env,
            cwd=self.root,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        parsed = json.loads(result.stdout)
        self.assertEqual(parsed, {"font": "Iosevka Nerd Font", "background": 0x1A1B26, "color14": 0x0DB9D7})


if __name__ == "__main__":
    unittest.main()
