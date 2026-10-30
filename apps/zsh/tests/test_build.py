"""Generate completions in staging without reading installed Zsh files."""

import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


APP = Path(__file__).resolve().parents[1]


class ZshBuildTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="luna next zsh build '")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.home = self.root / "home ' $(touch INJECTED)"
        self.home.mkdir()
        self.output = self.root / "staged config"
        shutil.copytree(APP / "config", self.output)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        for name in ("mkdir", "mv", "rm"):
            (self.bin / name).symlink_to(shutil.which(name))
        self.log = self.root / "mise arguments"
        self.env = {"HOME": str(self.home), "PATH": str(self.bin),
                    "LUNA_CONFIG_OUTPUT": str(self.output), "LUNA_TEST_LOG": str(self.log)}
        self.completion = self.output / "zsh/generated/mise-completion.zsh"

    def add_mise(self, fail=False):
        command = self.bin / "mise"
        command.write_text('''#!/usr/bin/python3
import json
import os
import sys
from pathlib import Path

Path(os.environ["LUNA_TEST_LOG"]).write_text(json.dumps(sys.argv[1:]))
print("# fresh completion")
sys.exit(''' + ("1" if fail else "0") + ")\n")
        command.chmod(0o755)

    def build(self):
        result = subprocess.run(["/bin/sh", str(APP / "src/build.sh")],
                                env=self.env, cwd=APP, capture_output=True,
                                text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout, "")
        return result.stderr

    def test_completion_is_fresh_and_uses_literal_home_instead_of_checkout(self):
        self.add_mise()
        self.assertEqual(self.build(), "")
        self.assertEqual(json.loads(self.log.read_text()),
                         ["--cd", str(self.home), "completion", "zsh"])
        self.assertEqual(self.completion.read_text(), "# fresh completion\n")
        self.assertFalse(self.completion.with_suffix(".zsh.tmp").exists())
        self.assertFalse((APP / "INJECTED").exists())

    def test_missing_mise_never_copies_an_installed_completion(self):
        previous = self.home / ".config/luna-next/zsh/generated/mise-completion.zsh"
        previous.parent.mkdir(parents=True)
        previous.write_text("# stale completion\n")
        self.assertIn("Mise is unavailable", self.build())
        self.assertFalse(self.completion.exists())
        self.assertEqual(previous.read_text(), "# stale completion\n")

    def test_failed_mise_discards_partial_output(self):
        self.add_mise(fail=True)
        self.assertIn("generation failed", self.build())
        self.assertFalse(self.completion.exists())
        self.assertEqual(list(self.completion.parent.iterdir()), [])

    def test_missing_staging_directory_fails_before_running_mise(self):
        self.add_mise()
        self.env.pop("LUNA_CONFIG_OUTPUT")
        result = subprocess.run(["/bin/sh", str(APP / "src/build.sh")],
                                env=self.env, cwd=APP, capture_output=True,
                                text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Missing configuration staging directory", result.stderr)
        self.assertFalse(self.log.exists())


if __name__ == "__main__":
    unittest.main()
