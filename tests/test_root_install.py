"""Exercise the root bootstrap without package installs, downloads, or desktop setup.

Run: python3 -m unittest discover -s tests -p test_root_install.py -v
"""

import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
REPO_URL = "https://github.com/dot-luna/luna-next.git"

MOCK = r'''
import json
import os
from pathlib import Path
import signal
import sys
import time

name = Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ["BOOTSTRAP_LOG"], "a") as log:
    log.write(json.dumps({"name": name, "args": args, "cwd": os.getcwd(),
                          "repo": os.environ.get("LUNA_NEXT_ROOT")}) + "\n")
if name == os.environ.get("BOOTSTRAP_FAIL"):
    print("simulated failure diagnostics", file=sys.stderr)
    sys.exit(17)
if name == "sudo" and args != ["-v"]:
    os.execv(Path(os.environ["BOOTSTRAP_BIN"]) / args[0], args)
elif name == "git":
    command = args[2:] if args[0] == "-C" else args
    state = json.loads(os.environ.get("BOOTSTRAP_GIT", "{}"))
    if command[0] == "clone":
        root = Path(args[-1])
        (root / ".git").mkdir(parents=True)
        if "yay.git" not in args[-2]:
            (root / "src/ln-cli").mkdir(parents=True)
    elif command[0] == "rev-parse":
        print(state.get("upstream", "origin/master") if "@{upstream}" in command
              else state.get("root", args[1]))
    elif command[0] == "remote":
        print(state.get("origin", "https://github.com/dot-luna/luna-next.git"))
    elif command[0] == "status":
        print(state.get("changes", ""), end="")
elif name == "mise" and "which" in args:
    print(Path(os.environ["BOOTSTRAP_BIN"]) / "bun")
elif name == "bun" and args[0] == "run":
    binary = Path.cwd() / "target/luna-bun"
    binary.parent.mkdir(parents=True, exist_ok=True)
    binary.write_bytes(Path(os.environ["BOOTSTRAP_MOCK"]).read_bytes())
    binary.chmod(0o755)
elif name == "sleep" and os.environ.get("BOOTSTRAP_CANCEL"):
    # Signal only the parent shell to verify the wait also kills its child.
    os.kill(os.getppid(), int(os.environ["BOOTSTRAP_CANCEL"]))
    time.sleep(30)
elif name in ("sudo", "sleep"):
    pass
elif name == "luna":
    print("self install called")
else:
    print("routine output that should stay hidden")
'''


@unittest.skipIf(os.geteuid() == 0, "Run bootstrap tests as a non-root user")
class RootInstallTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="luna bootstrap ' ")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.work = self.root / "work"
        self.work.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        # Only these harmless utilities are real; package/network commands are fake.
        for name in ("bash", "cat", "mkdir", "mktemp", "rm", "install", "mv"):
            (self.bin / name).symlink_to(shutil.which(name))
        self.mock = self.bin / "mock"
        self.mock.write_text(f"#!{shutil.which('python3')}\n" + MOCK)
        self.mock.chmod(0o755)
        for name in ("sudo", "pacman", "git", "mise", "makepkg", "bun", "sleep"):
            (self.bin / name).symlink_to(self.mock)
        self.log = self.root / "commands.jsonl"
        self.env = {
            "HOME": str(self.home), "PATH": str(self.bin), "LC_ALL": "C",
            "BOOTSTRAP_BIN": str(self.bin), "BOOTSTRAP_MOCK": str(self.mock),
            "BOOTSTRAP_LOG": str(self.log),
            # An inherited checkout must not change the installer's destination.
            "LUNA_NEXT_ROOT": str(self.work),
        }
        self.managed = self.home / ".local/src/luna-next"

    def run_install(self, *args, success=True, piped=False):
        command = [str(ROOT / "install.sh"), *args]
        kwargs = {}
        if piped:
            command = [str(self.bin / "bash"), "-s", "--", *args]
            kwargs["input"] = (ROOT / "install.sh").read_text()
        result = subprocess.run(command, env=self.env, cwd=self.work, capture_output=True,
                                text=True, timeout=10, **kwargs)
        self.assertEqual(result.returncode == 0, success, result.stdout + result.stderr)
        return result

    def commands(self, name=None):
        values = [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []
        return [item for item in values if name is None or item["name"] == name]

    def checkout(self, **state):
        (self.managed / ".git").mkdir(parents=True)
        (self.managed / "src/ln-cli").mkdir(parents=True)
        self.env["BOOTSTRAP_GIT"] = json.dumps(state)

    def test_default_install_prepares_sources_builds_and_hands_off(self):
        result = self.run_install()
        self.assertEqual(self.commands("pacman")[0]["args"], [
            "-Syu", "--needed", "--noconfirm", "--", "base-devel", "ca-certificates",
            "curl", "git", "mise", "sudo",
        ])
        self.assertEqual(self.commands("makepkg")[0]["args"],
                         ["--syncdeps", "--install", "--needed", "--noconfirm"])
        self.assertEqual(self.commands("mise")[0]["args"],
                         ["--cd", str(self.home), "use", "--global", "--yes", "bun@latest"])
        self.assertEqual(self.commands("git")[-1]["args"], ["clone", "--", REPO_URL, str(self.managed)])
        self.assertEqual(self.commands("bun")[0]["args"], ["install", "--frozen-lockfile"])
        self.assertEqual(self.commands("bun")[1]["args"], ["run", "--cwd", "src/ln-cli", "build"])
        self.assertEqual(self.commands("sleep")[0]["args"], ["5"])
        handoff = self.commands("luna")[0]
        self.assertEqual(handoff["args"], ["--repo", str(self.managed), "self", "install"])
        self.assertEqual(handoff["repo"], str(self.managed))
        self.assertTrue(os.access(self.home / ".local/bin/luna", os.X_OK))
        self.assertNotIn("routine output", result.stdout + result.stderr)
        self.assertIn("self install called", result.stdout)
        self.assertFalse(list((self.home / ".local/bin").glob(".luna.*")))

    def test_custom_relative_checkout_and_piped_input(self):
        self.run_install("--repo", "custom checkout", piped=True)
        selected = self.work / "custom checkout"
        self.assertEqual(self.commands("luna")[0]["args"], ["--repo", str(selected), "self", "install"])

    def test_existing_yay_is_reused(self):
        (self.bin / "yay").symlink_to(self.mock)
        self.run_install()
        self.assertEqual(self.commands("makepkg"), [])

    def test_clean_existing_checkout_only_fast_forwards(self):
        self.checkout()
        self.run_install()
        commands = self.commands("git")
        self.assertEqual(commands[-2]["args"][-2:], ["fetch", "origin"])
        self.assertEqual(commands[-1]["args"][-4:], ["merge", "--ff-only", "--no-autostash", "origin/master"])
        self.assertFalse(any("clone" in item["args"] and REPO_URL in item["args"] for item in commands))

    def test_unrelated_dirty_or_untracked_checkout_is_rejected(self):
        for state in ({"origin": "https://example.com/other.git"}, {"changes": " M file"},
                      {"changes": "?? personal"}, {"upstream": "elsewhere/master"}):
            with self.subTest(state=state):
                if not self.managed.exists():
                    self.checkout()
                self.env["BOOTSTRAP_GIT"] = json.dumps(state)
                self.log.unlink(missing_ok=True)
                self.run_install(success=False)
                self.assertEqual(self.commands("bun"), [])
                self.assertEqual(self.commands("luna"), [])

    def test_symlinked_directory_and_parent_components_fail_before_sudo(self):
        (self.home / "linked").symlink_to(self.work, target_is_directory=True)
        for destination in (str(self.home / "linked/repo"), str(self.home / "../repo")):
            with self.subTest(destination=destination):
                self.run_install("--repo", destination, success=False)
                self.assertEqual(self.commands(), [])

    def test_help_and_bad_flags_do_not_change_system(self):
        self.run_install("--help")
        for args in (("--repo",), ("--repo", "--help"), ("--unexpected",)):
            self.run_install(*args, success=False)
        self.assertEqual(self.commands(), [])

    def test_package_failure_shows_diagnostics_and_stops(self):
        self.env["BOOTSTRAP_FAIL"] = "pacman"
        result = self.run_install(success=False)
        self.assertEqual(result.returncode, 17)
        self.assertIn("simulated failure diagnostics", result.stderr)
        self.assertEqual(self.commands("git"), [])

    def test_failed_build_preserves_installed_cli(self):
        binary = self.home / ".local/bin/luna"
        binary.parent.mkdir(parents=True)
        binary.write_text("previous executable")
        self.env["BOOTSTRAP_FAIL"] = "bun"
        self.run_install(success=False)
        self.assertEqual(binary.read_text(), "previous executable")
        self.assertEqual(self.commands("luna"), [])

    def test_cli_failure_is_propagated(self):
        self.env["BOOTSTRAP_FAIL"] = "luna"
        result = self.run_install(success=False)
        self.assertEqual(result.returncode, 17)
        self.assertIn("simulated failure diagnostics", result.stderr)

    def test_interrupt_during_pause_prints_runnable_recovery_command(self):
        self.env["BOOTSTRAP_CANCEL"] = str(signal.SIGINT)
        result = self.run_install(success=False, piped=True)
        self.assertEqual(result.returncode, 130)
        self.assertIn("Other settings are not configured", result.stdout)
        self.assertEqual(self.commands("luna"), [])
        recovery = result.stdout.split("To finish, run:\n", 1)[1].strip()
        resumed = subprocess.run([str(self.bin / "bash"), "-c", recovery], env=self.env,
                                 capture_output=True, text=True, timeout=5)
        self.assertEqual(resumed.returncode, 0, resumed.stderr)
        self.assertEqual(self.commands("luna")[0]["args"], ["--repo", str(self.managed), "self", "install"])

    def test_termination_during_pause_skips_setup(self):
        self.env["BOOTSTRAP_CANCEL"] = str(signal.SIGTERM)
        result = self.run_install(success=False)
        self.assertEqual(result.returncode, 143)
        self.assertIn("To finish, run:", result.stdout)
        self.assertEqual(self.commands("luna"), [])


if __name__ == "__main__":
    unittest.main()
