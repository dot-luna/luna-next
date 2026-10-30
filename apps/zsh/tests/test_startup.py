"""Exercise the exported .zshrc using actual Zsh startup lookup."""

from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


APP = Path(__file__).resolve().parents[1]
ZSH = shutil.which("zsh")


@unittest.skipUnless(ZSH, "Zsh is required")
class ZshStartupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="luna next startup '")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.env = {"HOME": str(self.home), "PATH": str(self.bin), "TERM": "xterm"}

    def install(self, config_home, startup_directory):
        target = config_home / "luna-next/zsh"
        shutil.copytree(APP / "config/zsh", target)
        plugins = target / "plugins.zsh"
        plugins.write_text(plugins.read_text().replace("/usr/share/zsh", str(self.root / "share")))
        startup_directory.mkdir(parents=True, exist_ok=True)
        shutil.copy2(APP / "config/zshrc", startup_directory / ".zshrc")

    def assert_startup(self, config_home):
        result = subprocess.run([ZSH, "-d", "-i", "-c", '''
print -r -- "$STARSHIP_CONFIG"
print -r -- "$HISTSIZE:$SAVEHIST:$+functions[compdef]"
'''], env=self.env, cwd=self.root, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stderr, "")
        self.assertEqual(result.stdout.splitlines(),
                         [str(config_home / "starship.toml"), "32768:32768:1"])

    def test_startup_uses_home_defaults_for_unset_and_empty_xdg_home(self):
        config_home = self.home / ".config"
        self.install(config_home, self.home)
        self.assert_startup(config_home)
        self.env["XDG_CONFIG_HOME"] = ""
        self.assert_startup(config_home)

    def test_startup_supports_zdotdir_and_literal_xdg_paths(self):
        config_home = self.root / "config ' $HOME $(touch INJECTED)"
        zdotdir = self.root / "startup ' directory"
        self.install(config_home, zdotdir)
        self.env.update(XDG_CONFIG_HOME=str(config_home), ZDOTDIR=str(zdotdir))
        self.assert_startup(config_home)
        self.assertFalse((self.root / "INJECTED").exists())
        self.assertFalse((self.home / ".zshrc").exists())


if __name__ == "__main__":
    unittest.main()
