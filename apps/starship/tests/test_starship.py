import copy
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import tomllib
import unittest


APP = Path(__file__).resolve().parents[1]
STARSHIP = shutil.which("starship")
PYTHON = shutil.which("python3")


class StarshipBuildTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.output = self.root / "output"
        self.theme = json.loads((APP / "tests/fixtures/theme.json").read_text())
        self.response = self.root / "theme.json"
        binary = self.root / "bin/luna"
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
            LUNA_APP_DIR=str(APP),
            LUNA_CONFIG_OUTPUT=str(self.output),
            TEST_THEME=str(self.response),
            STARSHIP_CONFIG=str(self.output / "starship.toml"),
            STARSHIP_CACHE=str(self.root / "cache"),
            STARSHIP_LOG="error",
            TERM="xterm-256color",
        )
        self.env.pop("NO_COLOR", None)

    def build(self, response=None):
        self.response.write_text(json.dumps(response if response is not None else self.theme))
        return subprocess.run(
            [PYTHON, str(APP / "src/build.py")],
            env=self.env,
            capture_output=True,
            text=True,
        )

    def settings(self):
        return tomllib.loads((self.output / "starship.toml").read_text())

    def test_default_palette_and_bracketed_module_layout(self):
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stderr)
        settings = self.settings()
        self.assertTrue(settings["add_newline"])
        self.assertEqual(settings["command_timeout"], 200)
        self.assertEqual(settings["palette"], "luna_next")
        self.assertEqual(settings["directory"], {
            "truncation_length": 2,
            "truncation_symbol": "…/",
            "repo_root_style": "bold cyan",
            "repo_root_format": "[$repo_root]($repo_root_style)[$path]($style)[$read_only]($read_only_style) ",
        })
        self.assertEqual(settings["rust"]["format"], r"\[[$symbol($version)]($style)\]")
        self.assertEqual(settings["git_status"]["format"], r"([\[$all_status$ahead_behind\]]($style))")
        palette = settings["palettes"]["luna_next"]
        self.assertEqual(palette["blue"], "#7aa2f7")
        self.assertEqual(palette["cyan"], "#449dab")
        self.assertEqual(palette["bright-red"], "#ff7a93")
        self.assertEqual(palette["bright-white"], "#c0caf5")
        self.assertEqual(palette["purple"], palette["magenta"])
        self.assertEqual(palette["bright-purple"], palette["bright-magenta"])

    def test_custom_light_palette_overrides_all_named_ansi_colors(self):
        custom = copy.deepcopy(self.theme)
        colors = custom["result"]["colors"]
        colors["mode"] = "light"
        roles = (
            "dark_background", "error", "success", "warning", "link", "secondary_accent",
            "info", "light_foreground", "dark_foreground", "error_emphasis", "success_emphasis",
            "warning_emphasis", "link_emphasis", "secondary_accent_emphasis", "info_emphasis",
            "bright_foreground",
        )
        names = (
            "black", "red", "green", "yellow", "blue", "purple", "cyan", "white",
            "bright-black", "bright-red", "bright-green", "bright-yellow", "bright-blue",
            "bright-purple", "bright-cyan", "bright-white",
        )
        for index, role in enumerate(roles):
            colors[role] = f"#{index + 1:06x}"
        result = self.build(custom)
        self.assertEqual(result.returncode, 0, result.stderr)
        palette = self.settings()["palettes"]["luna_next"]
        self.assertEqual([palette[name] for name in names], [colors[role] for role in roles])

    def test_unresolved_theme_does_not_create_output(self):
        self.env.update(TEST_THEME_STATUS="1", TEST_THEME_ERROR="invalid selected theme")
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("invalid selected theme", result.stderr)
        self.assertFalse(self.output.exists())

    def test_incomplete_or_failed_response_preserves_existing_output(self):
        self.assertEqual(self.build().returncode, 0)
        output = self.output / "starship.toml"
        previous = output.read_bytes()
        incomplete = copy.deepcopy(self.theme)
        del incomplete["result"]["colors"]["success"]
        for response in (incomplete, {"ok": False, "error": "theme unavailable"}):
            with self.subTest(response=response):
                self.assertNotEqual(self.build(response).returncode, 0)
                self.assertEqual(output.read_bytes(), previous)

    @unittest.skipUnless(STARSHIP, "Starship is required for native prompt rendering")
    def test_native_starship_renders_brackets_with_theme_rgb_colors(self):
        self.theme["result"]["colors"].update(secondary_accent="#123456", link="#345678")
        self.assertEqual(self.build().returncode, 0)
        repository = self.root / "prompt-repo"
        repository.mkdir()
        subprocess.run(["git", "init", "-q", "-b", "theme-test", str(repository)], check=True)
        result = subprocess.run(
            [STARSHIP, "module", "git_branch", "--path", str(repository)],
            env=self.env,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        self.assertIn("[", result.stdout)
        self.assertIn("theme-test", result.stdout)
        self.assertIn("38;2;18;52;86", result.stdout)
        directory = subprocess.run(
            [STARSHIP, "module", "directory", "--path", str(repository), "--logical-path", str(repository)],
            env=self.env,
            capture_output=True,
            text=True,
        )
        self.assertEqual(directory.returncode, 0, directory.stderr)
        self.assertIn("38;2;68;157;171", directory.stdout)


if __name__ == "__main__":
    unittest.main()
