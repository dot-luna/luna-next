"""Check Starship config selection before initializing its interactive prompt."""

import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


REPO = Path(__file__).resolve().parents[3]
ZSH = shutil.which("zsh")
STARSHIP = shutil.which("starship")


@unittest.skipUnless(ZSH, "Zsh is required")
class StarshipModuleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="luna starship '")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.config = self.root / "installed config"
        (self.config / "luna-next/zsh").mkdir(parents=True)
        self.module = self.config / "luna-next/zsh/tools.zsh"
        shutil.copy2(REPO / "apps/zsh/config/zsh/tools.zsh", self.module)
        self.prompt = self.config / "starship.toml"
        self.prompt.write_text("command_timeout = 987\n")
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.starship = self.bin / "starship"
        self.starship.write_text('''#!/usr/bin/python3
import json
import os
import sys

assert sys.argv[1:] == ["init", "zsh"]
with open(os.environ["LUNA_TEST_LOG"], "a") as output:
    output.write(json.dumps(os.environ.get("STARSHIP_CONFIG")) + "\\n")
if os.environ.get("LUNA_TEST_FAIL"):
    print("export LUNA_TEST_PARTIAL_INIT=1")
    sys.exit(1)
print("prompt_starship_precmd() { return 0; }")
''')
        self.starship.chmod(0o755)
        self.log = self.root / "starship.log"
        self.env = {"HOME": str(self.home), "ZDOTDIR": str(self.home), "PATH": str(self.bin),
                    "TERM": "xterm", "XDG_CONFIG_HOME": str(self.config),
                    "LUNA_TEST_MODULE": str(self.module),
                    "LUNA_TEST_LOG": str(self.log)}

    def run_module(self, prefix="", interactive=True, repeat=False):
        arguments = [ZSH, "-d", "-f"]
        if interactive:
            arguments.append("-i")
        source = 'source "$LUNA_TEST_MODULE"\n'
        command = prefix + "\n" + source * (2 if repeat else 1) + '''
(( ! ${+luna_starship_config} && ! ${+luna_config_dir} && ! ${+luna_starship_init} )) || exit 1
/usr/bin/python3 -c 'import os, json; print(json.dumps(dict(os.environ)))'
'''
        result = subprocess.run([*arguments, "-c", command], env=self.env, cwd=self.root,
                                input="", capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stderr, "")
        return json.loads(result.stdout)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def test_xdg_config_is_exported_before_initialization_once(self):
        environment = self.run_module(repeat=True)
        self.assertEqual(environment["STARSHIP_CONFIG"], str(self.prompt))
        self.assertEqual(self.calls(), [str(self.prompt)])

    def test_xdg_config_path_is_literal_and_old_luna_override_is_unused(self):
        other = self.root / "custom ' $HOME $(touch INJECTED)"
        prompt = other / "starship.toml"
        prompt.parent.mkdir(parents=True)
        prompt.write_text("command_timeout = 876\n")
        self.env["XDG_CONFIG_HOME"] = str(other)
        self.env["LUNA_CONFIG_DIR"] = str(self.root / "old Luna")
        self.assertEqual(self.run_module()["STARSHIP_CONFIG"], str(prompt))
        self.assertEqual(self.calls(), [str(prompt)])
        self.assertFalse((self.root / "INJECTED").exists())

    def test_nonempty_override_is_preserved_and_exported(self):
        environment = self.run_module(prefix='STARSHIP_CONFIG="$HOME/my-prompt.toml"')
        override = str(self.home / "my-prompt.toml")
        self.assertEqual(environment["STARSHIP_CONFIG"], override)
        self.assertEqual(self.calls(), [override])

    def test_empty_override_uses_xdg_config(self):
        self.env["STARSHIP_CONFIG"] = ""
        self.assertEqual(self.run_module()["STARSHIP_CONFIG"], str(self.prompt))

    def test_missing_config_still_selects_declared_export_path(self):
        self.prompt.unlink()
        self.env["STARSHIP_CONFIG"] = ""
        self.assertEqual(self.run_module()["STARSHIP_CONFIG"], str(self.prompt))
        self.assertEqual(self.calls(), [str(self.prompt)])

    def test_unset_or_empty_xdg_home_uses_home_config(self):
        prompt = self.home / ".config/starship.toml"
        for value in (None, ""):
            with self.subTest(xdg_config_home=value):
                if value is None:
                    self.env.pop("XDG_CONFIG_HOME", None)
                else:
                    self.env["XDG_CONFIG_HOME"] = value
                self.assertEqual(self.run_module()["STARSHIP_CONFIG"], str(prompt))

    def test_existing_prompt_hook_still_gets_selected_configuration(self):
        environment = self.run_module(prefix="prompt_starship_precmd() { return 0; }")
        self.assertEqual(environment["STARSHIP_CONFIG"], str(self.prompt))
        self.assertFalse(self.log.exists())

    def test_noninteractive_shell_selects_config_without_initialization(self):
        self.assertEqual(self.run_module(interactive=False)["STARSHIP_CONFIG"], str(self.prompt))
        self.assertFalse(self.log.exists())

    def test_missing_starship_leaves_config_available_to_child_processes(self):
        self.starship.unlink()
        self.assertEqual(self.run_module()["STARSHIP_CONFIG"], str(self.prompt))
        self.assertFalse(self.log.exists())

    def test_failed_initializer_is_not_evaluated(self):
        self.env["LUNA_TEST_FAIL"] = "1"
        environment = self.run_module()
        self.assertNotIn("LUNA_TEST_PARTIAL_INIT", environment)
        self.assertEqual(environment["STARSHIP_CONFIG"], str(self.prompt))

    @unittest.skipUnless(STARSHIP, "Starship is required")
    def test_real_starship_reads_xdg_and_home_configuration(self):
        personal = self.home / ".config/starship.toml"
        personal.parent.mkdir()
        personal.write_text("command_timeout = 654\n")
        for custom_xdg, timeout in ((True, 987), (False, 654)):
            with self.subTest(custom_xdg=custom_xdg):
                if not custom_xdg:
                    self.env.pop("XDG_CONFIG_HOME")
                environment = self.run_module(interactive=False)
                result = subprocess.run([STARSHIP, "print-config", "command_timeout"],
                                        env=environment, cwd=self.home, capture_output=True,
                                        text=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(result.stderr, "")
                self.assertIn(f"command_timeout = {timeout}", result.stdout)


if __name__ == "__main__":
    unittest.main()
