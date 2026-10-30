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
INSTALL_URL = "https://raw.githubusercontent.com/dot-luna/luna-next/master/install/install.sh"
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
elif name == "curl":
    stage = "download-installer"
elif name == "git" and git_arguments[0] in ("clone", "fetch", "merge", "switch"):
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
elif name == "curl":
    print(Path(os.environ["SETUP_TEST_INSTALLER"]).read_text(), end="")
elif name == "git":
    state_file = Path(os.environ["SETUP_TEST_GIT_STATE"])
    state = json.loads(state_file.read_text())
    if git_arguments[0] == "check-ref-format":
        if state.get("invalid_ref"):
            sys.exit(1)
    elif git_arguments[0] == "clone":
        root = Path(arguments[-1])
        (root / ".git").mkdir(parents=True)
        (root / "src/ln-cli").mkdir(parents=True)
    elif git_arguments[0] == "rev-parse":
        if git_arguments[1] == "--show-toplevel":
            print(state.get("root", arguments[1]))
        elif git_arguments[-1] == "HEAD^{commit}":
            print(state.get("head", "c" * 40))
        else:
            print(("b" if git_arguments[-1].startswith("refs/tags/") else "a") * 40)
    elif git_arguments[0] == "remote":
        print(state.get("origin", "https://github.com/dot-luna/luna-next.git"))
    elif git_arguments[0] == "ls-remote":
        refs = state.get("refs", {"master": "branch"})
        for ref in git_arguments[3:]:
            ref_name = ref.removeprefix("refs/heads/").removeprefix("refs/tags/")
            kind = refs.get(ref_name)
            if kind == "both" or (kind == "branch" and ref.startswith("refs/heads/")) or (kind == "tag" and ref.startswith("refs/tags/")):
                print("a" * 40 + "\t" + ref)
    elif git_arguments[0] == "fetch":
        if "contained_refs_after_fetch" in state:
            state["contained_refs"] = state["contained_refs_after_fetch"]
            state_file.write_text(json.dumps(state))
    elif git_arguments[0] == "symbolic-ref":
        if state.get("detached"):
            sys.exit(1)
        print(state.get("branch", "master"))
    elif git_arguments[0] == "for-each-ref":
        print("\n".join(state.get("contained_refs", [])), end="")
    elif git_arguments[0] == "show-ref":
        if git_arguments[-1].removeprefix("refs/heads/") not in state.get("local_branches", ["master"]):
            sys.exit(1)
    elif git_arguments[0] == "switch":
        state["detached"] = "--detach" in git_arguments
        if state["detached"]:
            state["head"] = "b" * 40
        else:
            state["branch"] = git_arguments[-1].removeprefix("refs/remotes/origin/")
        state_file.write_text(json.dumps(state))
    elif git_arguments[0] == "status":
        print(state.get("changes", ""), end="")
    elif git_arguments[0] == "merge":
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
        self.published_installer = self.root / "published-install.sh"
        shutil.copy2(self.script, self.published_installer)
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
        for name in ("sudo", "pacman", "mise", "git", "systemctl", "curl"):
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
            "SETUP_TEST_INSTALLER": str(self.published_installer),
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
                         ["sudo", "pacman", "sudo", "pacman", "git", "git", "mise", "mise", "systemctl"])
        self.assertEqual(self.commands("pacman")[0]["args"], ["-Syu", "--noconfirm"])
        self.assertEqual(self.commands("pacman")[1]["args"],
                         ["-S", "--needed", "--noconfirm", "--", "git", "gcc", "mise"])
        self.assertEqual(self.commands("git")[0]["args"],
                         ["check-ref-format", "refs/heads/master"])
        self.assertEqual(self.commands("git")[1]["args"],
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
        self.assertEqual(self.commands()[0]["name"], "curl")
        self.assertEqual(self.commands("curl")[0]["args"],
                         ["-fsSL", "--proto", "=https", "--tlsv1.2", INSTALL_URL])
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
        self.assertEqual(self.commands("git")[1]["args"][-1], str(self.managed))
        self.assertEqual(self.environment_file.read_text(), ENVIRONMENT)
        self.assertEqual(self.commands("luna"), [])

    def test_setup_runs_from_stdin_without_a_source_checkout(self):
        script = self.script.with_name("setup.sh").read_text()
        shutil.rmtree(self.source)
        result = subprocess.run([str(self.bin / "bash"), "-s", "--", "--json", "--ref", "feature/ui"],
                                input=script, cwd=self.work, env=self.env, text=True,
                                capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.commands("git")[1]["args"][-1], str(self.managed))
        self.assertEqual(self.commands("git")[1]["args"][1:3], ["--branch", "feature/ui"])
        self.assertEqual(self.commands("luna")[0]["args"],
                         ["setup", "--repo", str(self.managed), "--json"])
        self.assertEqual(self.environment_file.read_text(), ENVIRONMENT)
        self.assertEqual(list(self.work.iterdir()), [])

    def test_setup_download_failure_prevents_installation_and_setup(self):
        self.env["SETUP_TEST_FAIL"] = "download-installer"
        result = self.run_install(success=False, setup=True)
        self.assertEqual(result.returncode, 17)
        self.assertEqual([item["name"] for item in self.commands()], ["curl"])
        self.assertFalse(self.managed.exists())
        self.assertFalse(self.environment_file.exists())

    def test_setup_requires_curl_before_installation(self):
        (self.bin / "curl").unlink()
        result = self.run_install(success=False, setup=True)
        self.assertIn("curl is required", result.stderr)
        self.assertEqual(self.commands(), [])

    def test_setup_rejects_missing_or_duplicate_ref_before_download(self):
        for arguments in (("--ref",), ("--ref", ""), ("--ref", "--json"),
                          ("--ref", "master", "--ref", "other")):
            with self.subTest(arguments=arguments):
                result = self.run_install(success=False, setup=True, arguments=arguments)
                self.assertIn("--ref", result.stderr)
                self.assertEqual(self.commands(), [])

    def test_existing_checkout_updates_only_by_fast_forward_and_preserves_files(self):
        self.make_checkout()
        self.run_install()
        git = self.commands("git")
        self.assertEqual(git[-1]["args"],
                         ["-C", str(self.managed), "merge", "--ff-only", "--no-autostash",
                          "--no-overwrite-ignore", "refs/remotes/origin/master"])
        self.assertFalse(any("clone" in command["args"] for command in git))
        self.assertEqual((self.managed / "local-file").read_text(), "keep this file")
        self.assertEqual((self.managed / ".git/updated").read_text(), "fast-forwarded")

    def test_existing_checkout_fetches_and_creates_requested_remote_branch(self):
        self.make_checkout(refs={"feature/ui": "branch"})
        self.run_install(arguments=("--ref", "feature/ui"))
        git = [item["args"][2:] for item in self.commands("git") if item["args"][0] == "-C"]
        self.assertIn(["fetch", "--no-tags", "origin",
                       "+refs/heads/feature/ui:refs/remotes/origin/feature/ui"], git)
        self.assertIn(["switch", "--no-overwrite-ignore", "--no-track", "-c", "feature/ui",
                       "refs/remotes/origin/feature/ui"], git)
        self.assertEqual(git[-1], ["merge", "--ff-only", "--no-autostash", "--no-overwrite-ignore",
                                  "refs/remotes/origin/feature/ui"])
        self.assertEqual((self.managed / "local-file").read_text(), "keep this file")

    def test_default_ref_switches_an_existing_clean_feature_branch_to_master(self):
        self.make_checkout(branch="feature")
        self.run_install()
        self.assertIn(["-C", str(self.managed), "switch", "--no-overwrite-ignore", "--no-guess", "master"],
                      [item["args"] for item in self.commands("git")])

    def test_requested_tag_uses_detached_checkout_and_can_be_installed_again(self):
        self.make_checkout(refs={"v1.0": "tag"})
        self.run_install(arguments=("--ref", "v1.0"))
        self.run_install(arguments=("--ref", "v1.0"))
        git = [item["args"][2:] for item in self.commands("git") if item["args"][0] == "-C"]
        self.assertEqual(git.count(["fetch", "--no-tags", "origin", "+refs/tags/v1.0:refs/tags/v1.0"]), 2)
        self.assertEqual(git.count(["switch", "--no-overwrite-ignore", "--detach", "refs/tags/v1.0"]), 2)
        self.assertFalse(any(item[0] in ("show-ref", "merge") for item in git))
        self.assertEqual(len(self.commands("mise")), 4)

    def test_detached_checkout_retained_by_another_ref_can_switch(self):
        self.make_checkout(detached=True, contained_refs=["refs/tags/previous"])
        self.run_install()
        self.assertTrue((self.managed / ".git/updated").exists())

    def test_refreshing_a_tag_does_not_misclassify_its_old_commit_as_local_work(self):
        self.make_checkout(detached=True, refs={"v1.0": "tag"},
                           contained_refs=["refs/tags/v1.0"], contained_refs_after_fetch=[])
        self.run_install(arguments=("--ref", "v1.0"))
        self.assertEqual(len(self.commands("mise")), 2)
        self.assertEqual(json.loads(self.git_state.read_text())["head"], "b" * 40)

    def test_missing_remote_ref_stops_before_switch_or_build(self):
        self.make_checkout()
        result = self.run_install(success=False, arguments=("--ref", "missing"))
        self.assertIn("No remote branch or tag", result.stderr)
        self.assertFalse(any(operation in item["args"] for item in self.commands("git")
                             for operation in ("fetch", "switch", "merge")))
        self.assertEqual(self.commands("mise"), [])

    def test_malformed_or_missing_installer_ref_fails_before_packages(self):
        for arguments in (("--ref",), ("--ref", ""), ("--ref", "bad..name"),
                          ("--ref", "--json"), ("--ref", "bad name"), ("--unknown",)):
            with self.subTest(arguments=arguments):
                self.run_install(success=False, arguments=arguments)
                self.assertEqual(self.commands(), [])

    def test_failed_ref_fetch_prevents_build_and_setup(self):
        self.make_checkout()
        self.env["SETUP_TEST_FAIL"] = "fetch"
        result = self.run_install(success=False, setup=True)
        self.assertEqual(result.returncode, 17)
        self.assertEqual(self.commands("mise"), [])
        self.assertEqual(self.commands("luna"), [])
        self.assertFalse((self.managed / ".git/updated").exists())

    def test_dirty_wrong_origin_unreferenced_detached_checkout_are_not_updated(self):
        self.make_checkout()
        for state, message in (
            ({"changes": "?? local-file\n"}, "local changes"),
            ({"changes": " M Cargo.toml\n"}, "local changes"),
            ({"origin": "https://github.com/someone/other.git"}, "different origin"),
            ({"detached": True}, "detached"),
            ({"root": str(self.managed.parent)}, "repository root"),
        ):
            with self.subTest(state=state):
                self.git_state.write_text(json.dumps(state))
                result = self.run_install(success=False)
                self.assertIn(message, result.stderr)
                self.assertFalse(any("merge" in item["args"] for item in self.commands("git")))
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
        self.assertEqual([item["args"] for item in self.commands("git")],
                         [["check-ref-format", "refs/heads/master"]])
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
        self.env["SETUP_TEST_FAIL"] = "merge"
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
