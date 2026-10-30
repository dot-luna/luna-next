"""Exercise scripts/setup.sh with fake package and CLI commands.

Run: python3 -m unittest discover -s tests -p test_setup.py -v
"""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]

MOCK_COMMAND = r'''
import json
import os
from pathlib import Path
import shutil
import sys

name = Path(sys.argv[0]).name
arguments = sys.argv[1:]
with open(os.environ["SETUP_TEST_LOG"], "a") as log:
    log.write(json.dumps({"name": name, "args": arguments, "cwd": os.getcwd()}) + "\n")

stage = None
if name == "pacman":
    stage = "update" if arguments[0] == "-Syu" else "install-packages"
elif name == "mise":
    stage = "install-rust" if "use" in arguments else "install-cli"
elif name == "luna":
    stage = "setup"
    assert shutil.which("luna") == str(Path(os.environ["HOME"]) / ".local/bin/luna")
if stage is not None and stage == os.environ.get("SETUP_TEST_FAIL"):
    sys.exit(17)
if name == "sudo":
    command = Path(os.environ["SETUP_TEST_BIN"]) / arguments[0]
    os.execv(command, arguments)
elif stage == "install-cli":
    installed_cli = Path(os.environ["HOME"]) / ".local/bin/luna"
    installed_cli.parent.mkdir(parents=True)
    installed_cli.symlink_to(Path(os.environ["SETUP_TEST_BIN"]) / "mock-command")
'''


@unittest.skipIf(os.geteuid() == 0, "Run the setup tests as a non-root user")
class SetupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="luna setup ' ")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.repo = self.root / "repo"
        scripts = self.repo / "scripts"
        scripts.mkdir(parents=True)
        self.script = scripts / "setup.sh"
        shutil.copy2(ROOT / "scripts/setup.sh", self.script)
        (self.repo / "src/ln-cli").mkdir(parents=True)
        self.home = self.root / "home"
        self.home.mkdir()
        self.work = self.root / "unrelated directory"
        self.work.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        # Restricted PATH cannot reach real package or network commands.
        for name in ("bash", "dirname", "pwd"):
            (self.bin / name).symlink_to(shutil.which(name))
        mock = self.bin / "mock-command"
        mock.write_text(f"#!{shutil.which('python3')}\n" + MOCK_COMMAND)
        mock.chmod(0o755)
        for name in ("sudo", "pacman", "mise", "sleep"):
            (self.bin / name).symlink_to(mock)
        self.log = self.root / "commands.jsonl"
        self.env = {
            "HOME": str(self.home),
            "PATH": str(self.bin),
            "LC_ALL": "C",
            "SETUP_TEST_LOG": str(self.log),
            "SETUP_TEST_BIN": str(self.bin),
        }
        update = ["-Syu", "--noconfirm"]
        packages = ["-S", "--needed", "--noconfirm", "--", "gcc", "mise"]
        rust = ["--cd", str(self.home), "use", "--global", "--yes", "--fuzzy", "--", "rust@stable"]
        cli = ["--cd", str(self.home), "exec", "rust@stable", "--", "cargo", "install",
               "--locked", "--force", "--path", str(self.repo / "src/ln-cli"),
               "--root", str(self.home / ".local")]
        self.expected = [
            {"name": name, "args": args, "cwd": str(self.work)}
            for name, args in (
                ("sudo", ["pacman", *update]),
                ("pacman", update),
                ("sudo", ["pacman", *packages]),
                ("pacman", packages),
                ("mise", rust),
                ("mise", cli),
                ("sleep", ["5"]),
            )
        ]
        self.expected.append({"name": "luna", "args": ["setup"], "cwd": str(self.repo)})

    def run_setup(self, success=True):
        result = subprocess.run([str(self.script)], cwd=self.work, env=self.env,
                                text=True, capture_output=True, timeout=10)
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def commands(self):
        if not self.log.exists():
            return []
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def test_installs_tools_and_local_cli_then_runs_setup_from_repository(self):
        result = self.run_setup()
        self.assertEqual(self.commands(), self.expected)
        self.assertIn("Running luna setup in 5 seconds...", result.stdout)
        self.assertTrue((self.home / ".local/bin/luna").is_file())
        self.assertEqual(list(self.work.iterdir()), [])

    def test_failure_at_each_installation_stage_stops_before_later_actions(self):
        for stage, count in (("update", 2), ("install-packages", 4),
                             ("install-rust", 5), ("install-cli", 6)):
            with self.subTest(stage=stage):
                self.env["SETUP_TEST_FAIL"] = stage
                result = self.run_setup(success=False)
                self.assertEqual(result.returncode, 17)
                self.assertEqual(self.commands(), self.expected[:count])
                self.assertNotIn("Running luna setup", result.stdout)
                self.assertFalse((self.home / ".local").exists())
                self.log.unlink()

    def test_cli_setup_failure_is_returned_to_caller(self):
        self.env["SETUP_TEST_FAIL"] = "setup"
        result = self.run_setup(success=False)
        self.assertEqual(result.returncode, 17)
        self.assertEqual(self.commands(), self.expected)

    def test_invalid_home_fails_before_package_changes(self):
        for home in ("", "relative/home", "/", None):
            with self.subTest(home=home):
                if home is None:
                    self.env.pop("HOME", None)
                else:
                    self.env["HOME"] = home
                self.run_setup(success=False)
                self.assertEqual(self.commands(), [])

    def test_missing_prerequisite_fails_before_package_changes(self):
        for name in ("sudo", "pacman"):
            with self.subTest(command=name):
                command = self.bin / name
                command.unlink()
                try:
                    self.run_setup(success=False)
                    self.assertEqual(self.commands(), [])
                finally:
                    command.symlink_to(self.bin / "mock-command")


if __name__ == "__main__":
    unittest.main()
