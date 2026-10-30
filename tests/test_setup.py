"""Run bootstrap scripts with isolated homes and fake package/network commands.

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
REPO_URL = "https://github.com/dot-luna/luna-next.git"
ENVIRONMENT = (
    "LUNA_NEXT_ROOT=${HOME}/.local/src/luna-next\n"
    "PATH=${HOME}/.local/bin:${PATH}\n"
)

MOCK_COMMAND = r'''
import json
import os
from pathlib import Path
import sys

name = Path(sys.argv[0]).name
arguments = sys.argv[1:]
with open(os.environ["SETUP_TEST_LOG"], "a") as log:
    log.write(json.dumps({
        "name": name, "args": arguments, "cwd": os.getcwd(),
        "root": os.environ.get("LUNA_NEXT_ROOT"), "path": os.environ["PATH"],
    }) + "\n")

stage = None
git_arguments = arguments[2:] if name == "git" and arguments[0] == "-C" else arguments
if name == "pacman":
    stage = "update" if arguments[0] == "-Syu" else "install-packages"
elif name == "git" and git_arguments[0] in ("clone", "pull"):
    stage = git_arguments[0]
elif name == "mise":
    stage = "install-rust" if "use" in arguments else "install-cli"
elif name == "systemctl":
    stage = "user-manager"
elif name == "luna":
    stage = "setup"
if stage is not None and stage == os.environ.get("SETUP_TEST_FAIL"):
    sys.exit(17)

if name == "sudo":
    command = Path(os.environ["SETUP_TEST_BIN"]) / arguments[0]
    os.execv(command, arguments)
elif name == "git":
    state = json.loads(Path(os.environ["SETUP_TEST_GIT_STATE"]).read_text())
    if git_arguments[0] == "clone":
        root = Path(arguments[-1])
        (root / ".git").mkdir(parents=True)
        (root / "src/ln-cli").mkdir(parents=True)
    elif git_arguments[0] == "rev-parse":
        print(state.get("root", arguments[1]))
    elif git_arguments[0] == "remote":
        print(state.get("origin", "https://github.com/dot-luna/luna-next.git"))
    elif git_arguments[0] == "symbolic-ref":
        if state.get("detached"):
            sys.exit(1)
        print(state.get("branch", "master"))
    elif git_arguments[0] == "status":
        print(state.get("changes", ""), end="")
    elif git_arguments[0] == "pull":
        (Path(arguments[1]) / ".git/updated").write_text("fast-forwarded")
    else:
        raise AssertionError(arguments)
elif stage == "install-cli":
    installed_cli = Path(os.environ["HOME"]) / ".local/bin/luna"
    installed_cli.parent.mkdir(parents=True, exist_ok=True)
    if installed_cli.is_symlink():
        installed_cli.unlink()
    installed_cli.symlink_to(Path(os.environ["SETUP_TEST_BIN"]) / "mock-command")
'''


@unittest.skipIf(os.geteuid() == 0, "Run the setup tests as a non-root user")
class SetupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="luna install ' ")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "coding/repo"
        installers = self.source / "install"
        installers.mkdir(parents=True)
        for name in ("install.sh", "setup.sh"):
            shutil.copy2(ROOT / "install" / name, installers / name)
        self.script = installers / "install.sh"
        self.home = self.root / "home"
        self.home.mkdir()
        self.managed = self.home / ".local/src/luna-next"
        self.environment_file = self.home / ".config/environment.d/60-luna-next.conf"
        self.work = self.root / "unrelated directory"
        self.work.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        # Restricted PATH cannot run real Git, pacman, mise, or systemctl.
        for name in ("bash", "dirname", "mkdir", "mktemp", "chmod", "mv", "rm"):
            (self.bin / name).symlink_to(shutil.which(name))
        mock = self.bin / "mock-command"
        mock.write_text(f"#!{shutil.which('python3')}\n" + MOCK_COMMAND)
        mock.chmod(0o755)
        for name in ("sudo", "pacman", "mise", "git", "systemctl"):
            (self.bin / name).symlink_to(mock)
        self.log = self.root / "commands.jsonl"
        self.git_state = self.root / "git-state.json"
        self.git_state.write_text("{}")
        self.env = {
            "HOME": str(self.home),
            "PATH": str(self.bin),
            "LC_ALL": "C",
            "LUNA_NEXT_ROOT": str(self.source),
            "SETUP_TEST_LOG": str(self.log),
            "SETUP_TEST_BIN": str(self.bin),
            "SETUP_TEST_GIT_STATE": str(self.git_state),
        }

    def run_install(self, success=True, setup=False, arguments=()):
        script = self.script.with_name("setup.sh") if setup else self.script
        result = subprocess.run([str(script), *arguments], cwd=self.work, env=self.env,
                                text=True, capture_output=True, timeout=10)
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def commands(self, name=None):
        if not self.log.exists():
            return []
        commands = [json.loads(line) for line in self.log.read_text().splitlines()]
        return [item for item in commands if name is None or item["name"] == name]

    def make_checkout(self, **state):
        (self.managed / ".git").mkdir(parents=True)
        (self.managed / "src/ln-cli").mkdir(parents=True)
        (self.managed / "local-file").write_text("keep this file")
        self.git_state.write_text(json.dumps(state))

    def test_installer_clones_managed_checkout_and_installs_without_setup(self):
        self.run_install()
        commands = self.commands()
        self.assertEqual([item["name"] for item in commands],
                         ["sudo", "pacman", "sudo", "pacman", "git", "mise", "mise", "systemctl"])
        self.assertEqual(self.commands("pacman")[0]["args"], ["-Syu", "--noconfirm"])
        self.assertEqual(self.commands("pacman")[1]["args"],
                         ["-S", "--needed", "--noconfirm", "--", "git", "gcc", "mise"])
        self.assertEqual(self.commands("git")[0]["args"],
                         ["clone", "--branch", "master", "--single-branch", "--", REPO_URL, str(self.managed)])
        self.assertEqual(self.commands("mise")[0]["args"],
                         ["--cd", str(self.home), "use", "--global", "--yes", "--fuzzy", "--", "rust@stable"])
        self.assertEqual(self.commands("mise")[1]["args"],
                         ["--cd", str(self.home), "exec", "rust@stable", "--", "cargo", "install",
                          "--locked", "--force", "--path", str(self.managed / "src/ln-cli"),
                          "--root", str(self.home / ".local")])
        self.assertEqual(self.commands("systemctl")[0]["args"],
                         ["--user", "import-environment", "LUNA_NEXT_ROOT", "PATH"])
        for command in commands:
            self.assertEqual(command["root"], str(self.managed))
            self.assertEqual(command["path"].split(":"), [str(self.home / ".local/bin"), str(self.bin)])
        self.assertEqual(self.commands("luna"), [])
        self.assertEqual(self.environment_file.read_text(), ENVIRONMENT)
        self.assertEqual(self.environment_file.stat().st_mode & 0o777, 0o600)
        self.assertEqual(list(self.work.iterdir()), [])
        self.assertFalse((self.home / ".profile").exists())

    def test_setup_calls_install_then_setup_once_with_managed_repo(self):
        self.run_install(setup=True, arguments=("--json",))
        self.assertEqual(self.commands()[-1]["name"], "luna")
        self.assertEqual(len(self.commands("luna")), 1)
        self.assertEqual(self.commands("luna")[0]["args"],
                         ["setup", "--repo", str(self.managed), "--json"])
        self.assertEqual(self.commands("luna")[0]["root"], str(self.managed))

    def test_installer_runs_from_stdin_without_a_source_checkout(self):
        result = subprocess.run([str(self.bin / "bash")], input=self.script.read_text(),
                                cwd=self.work, env=self.env, text=True,
                                capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.commands("git")[0]["args"][-1], str(self.managed))
        self.assertEqual(self.environment_file.read_text(), ENVIRONMENT)
        self.assertEqual(self.commands("luna"), [])

    def test_existing_checkout_updates_only_by_fast_forward_and_preserves_files(self):
        self.make_checkout()
        self.run_install()
        git = self.commands("git")
        self.assertEqual(git[-1]["args"],
                         ["-C", str(self.managed), "pull", "--ff-only", "--no-rebase", "origin", "master"])
        self.assertFalse(any("clone" in command["args"] for command in git))
        self.assertEqual((self.managed / "local-file").read_text(), "keep this file")
        self.assertEqual((self.managed / ".git/updated").read_text(), "fast-forwarded")

    def test_dirty_wrong_origin_detached_and_feature_checkout_are_not_updated(self):
        self.make_checkout()
        for state, message in (
            ({"changes": "?? local-file\n"}, "local changes"),
            ({"changes": " M Cargo.toml\n"}, "local changes"),
            ({"origin": "https://github.com/someone/other.git"}, "different origin"),
            ({"detached": True}, "detached"),
            ({"branch": "feature"}, "on master"),
            ({"root": str(self.managed.parent)}, "repository root"),
        ):
            with self.subTest(state=state):
                self.git_state.write_text(json.dumps(state))
                result = self.run_install(success=False)
                self.assertIn(message, result.stderr)
                self.assertFalse(any("pull" in item["args"] for item in self.commands("git")))
                self.assertEqual(self.commands("mise"), [])
                self.assertEqual((self.managed / "local-file").read_text(), "keep this file")
                self.log.unlink()

    def test_unrelated_destination_is_refused_without_changing_its_contents(self):
        self.managed.mkdir(parents=True)
        sentinel = self.managed / "notes"
        sentinel.write_text("unrelated contents")
        result = self.run_install(success=False)
        self.assertIn("not a standalone Git checkout", result.stderr)
        self.assertEqual(list(self.managed.iterdir()), [sentinel])
        self.assertEqual(sentinel.read_text(), "unrelated contents")
        self.assertEqual(self.commands("git"), [])
        self.assertEqual(self.commands("mise"), [])

    def test_symlinked_managed_directory_is_refused_before_packages(self):
        outside = self.root / "outside"
        outside.mkdir()
        (outside / "sentinel").write_text("untouched")
        self.managed.parent.mkdir(parents=True)
        self.managed.symlink_to(outside, target_is_directory=True)
        result = self.run_install(success=False)
        self.assertIn("symlinked directory", result.stderr)
        self.assertEqual(self.commands(), [])
        self.assertEqual((outside / "sentinel").read_text(), "untouched")

    def test_symlinked_environment_file_is_refused_without_touching_target(self):
        outside = self.root / "outside.conf"
        outside.write_text("do not overwrite")
        self.environment_file.parent.mkdir(parents=True)
        self.environment_file.symlink_to(outside)
        self.run_install(success=False)
        self.assertEqual(self.commands(), [])
        self.assertEqual(outside.read_text(), "do not overwrite")

    def test_environment_uses_custom_config_home_and_replaces_only_owned_file(self):
        config = self.root / "custom config"
        self.env["XDG_CONFIG_HOME"] = str(config)
        owned = config / "environment.d/60-luna-next.conf"
        owned.parent.mkdir(parents=True)
        owned.write_text("old configuration")
        unrelated = owned.with_name("50-user.conf")
        unrelated.write_text("USER_SETTING=keep\n")
        self.run_install()
        self.assertEqual(owned.read_text(), ENVIRONMENT)
        self.assertEqual(unrelated.read_text(), "USER_SETTING=keep\n")
        self.assertFalse(self.environment_file.exists())

    def test_package_clone_and_toolchain_failures_prevent_setup(self):
        for stage in ("update", "install-packages", "clone", "install-rust", "install-cli"):
            with self.subTest(stage=stage):
                self.env["SETUP_TEST_FAIL"] = stage
                result = self.run_install(success=False, setup=True)
                self.assertEqual(result.returncode, 17)
                self.assertEqual(self.commands("luna"), [])
                self.assertFalse(self.environment_file.exists())
                self.log.unlink()
                if self.managed.exists():
                    shutil.rmtree(self.managed)

    def test_failed_fast_forward_preserves_checkout_and_stops_install(self):
        self.make_checkout()
        self.env["SETUP_TEST_FAIL"] = "pull"
        result = self.run_install(success=False, setup=True)
        self.assertEqual(result.returncode, 17)
        self.assertEqual((self.managed / "local-file").read_text(), "keep this file")
        self.assertEqual(self.commands("mise"), [])
        self.assertEqual(self.commands("luna"), [])

    def test_setup_failure_is_returned_to_caller(self):
        self.env["SETUP_TEST_FAIL"] = "setup"
        result = self.run_install(success=False, setup=True)
        self.assertEqual(result.returncode, 17)
        self.assertEqual(len(self.commands("luna")), 1)

    def test_missing_user_manager_is_nonfatal(self):
        self.env["SETUP_TEST_FAIL"] = "user-manager"
        result = self.run_install()
        self.assertIn("next login", result.stdout)
        self.assertEqual(self.environment_file.read_text(), ENVIRONMENT)

    def test_absent_systemctl_is_not_an_install_requirement(self):
        (self.bin / "systemctl").unlink()
        self.run_install()
        self.assertEqual(self.commands("systemctl"), [])

    def test_invalid_home_and_relative_config_fail_before_package_changes(self):
        for home in ("", "relative/home", "/", str(self.root / "missing"), None):
            with self.subTest(home=home):
                if home is None:
                    self.env.pop("HOME", None)
                else:
                    self.env["HOME"] = home
                self.run_install(success=False)
                self.assertEqual(self.commands(), [])
        self.env["HOME"] = str(self.home)
        self.env["XDG_CONFIG_HOME"] = "relative/config"
        self.run_install(success=False)
        self.assertEqual(self.commands(), [])

    def test_missing_prerequisite_fails_before_package_changes(self):
        for name in ("sudo", "pacman"):
            with self.subTest(command=name):
                command = self.bin / name
                command.unlink()
                try:
                    self.run_install(success=False)
                    self.assertEqual(self.commands(), [])
                finally:
                    command.symlink_to(self.bin / "mock-command")


if __name__ == "__main__":
    unittest.main()
