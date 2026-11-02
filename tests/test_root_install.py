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
command = args[2:] if name == "git" and args[0] == "-C" else args
operation = "use" if name == "mise" and "use" in args else command[0]
if os.environ.get("BOOTSTRAP_FAIL_ONCE") == f"{name}:{operation}":
    marker = Path(os.environ["BOOTSTRAP_ONCE_MARKER"])
    if not marker.exists():
        marker.touch()
        print("discard this failed attempt's output")
        print("temporary download failure", file=sys.stderr)
        sys.exit(17)
if name == os.environ.get("BOOTSTRAP_FAIL"):
    print("simulated failure diagnostics", file=sys.stderr)
    sys.exit(17)
if name == "sudo" and args != ["-v"]:
    os.execv(Path(os.environ["BOOTSTRAP_BIN"]) / args[0], args)
elif name == "git":
    command = args[2:] if args[0] == "-C" else args
    state = json.loads(os.environ.get("BOOTSTRAP_GIT", "{}"))
    if command[0] == os.environ.get("BOOTSTRAP_GIT_FAIL"):
        print("simulated git failure", file=sys.stderr)
        sys.exit(17)
    if command[0] == "clone":
        root = Path(args[-1])
        (root / ".git").mkdir(parents=True)
        if "yay.git" not in args[-2]:
            (root / "src/luna-cli").mkdir(parents=True)
            if os.environ.get("BOOTSTRAP_RACE_DEST"):
                (Path(os.environ["BOOTSTRAP_RACE_DEST"]) / ".personal").write_text("keep me")
    elif command[0] == "rev-parse":
        if "--verify" in command:
            print(state.get("head" if command[-1] == "HEAD^{commit}" else "selected", "a" * 40))
        else:
            print(state.get("root", args[1]))
    elif command[0] == "remote":
        print(state.get("origin", "https://github.com/dot-luna/luna-next.git"))
    elif command[0] == "status":
        print(state.get("changes", ""), end="")
    elif command[0] == "ls-remote":
        if "--symref" in command:
            if not state.get("missing_default"):
                print("ref: refs/heads/" + state.get("default", "master") + "\tHEAD")
        else:
            for ref in command[3:]:
                kind, value = ref.removeprefix("refs/").split("/", 1)
                if state.get("refs", {"master": "heads"}).get(value) in (kind, "both"):
                    print("a" * 40 + "\t" + ref)
    elif command[0] == "symbolic-ref":
        if state.get("detached"):
            sys.exit(1)
    elif command[0] == "for-each-ref":
        print("\n".join(state.get("retained_refs", [])), end="")
    elif command[0] == "show-ref":
        if command[-1].removeprefix("refs/heads/") not in state.get("local_branches", ["master"]):
            sys.exit(1)
elif name == "mise" and "which" in args:
    print(Path(os.environ["BOOTSTRAP_BIN"]) / "bun")
elif name == "bun" and args[0] == "run":
    package = args[args.index("--cwd") + 1]
    if package == os.environ.get("BOOTSTRAP_BUILD_FAIL"):
        print("simulated dependency build failure", file=sys.stderr)
        sys.exit(17)
    if package == "packages/luna-api":
        assert (Path.cwd() / "target/luna-logger/index.js").is_file(), "logger must build before API"
    elif package == "src/luna-cli":
        assert (Path.cwd() / "target/luna-api/index.js").is_file(), "API must build before CLI"
    if package != "src/luna-cli":
        output = Path.cwd() / "target" / Path(package).name / "index.js"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text("built dependency")
        sys.exit(0)
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
        for name in ("bash", "cat", "mkdir", "mktemp", "rm", "install", "mv", "realpath"):
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
            "BOOTSTRAP_ONCE_MARKER": str(self.root / "once"),
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
        (self.managed / "src/luna-cli").mkdir(parents=True)
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
        clone = self.commands("git")[-1]["args"]
        self.assertEqual(clone[:-1], ["clone", "--branch", "master", "--single-branch", "--", REPO_URL])
        self.assertEqual(Path(clone[-1]).parent, self.managed.parent)
        self.assertFalse(Path(clone[-1]).exists())
        self.assertTrue((self.managed / ".git").is_dir())
        self.assertEqual(self.commands("bun")[0]["args"], ["install", "--frozen-lockfile"])
        self.assertEqual([item["args"] for item in self.commands("bun")[1:]], [
            ["run", "--cwd", "packages/luna-logger", "build"],
            ["run", "--cwd", "packages/luna-api", "build"],
            ["run", "--cwd", "src/luna-cli", "build"],
        ])
        self.assertEqual(self.commands("sleep")[0]["args"], ["5"])
        handoff = self.commands("luna")[0]
        self.assertEqual(handoff["args"], ["self", "install"])
        self.assertEqual(handoff["repo"], str(self.managed))
        self.assertTrue(os.access(self.home / ".local/bin/luna", os.X_OK))
        self.assertNotIn("routine output", result.stdout + result.stderr)
        self.assertIn("self install called", result.stdout)
        self.assertFalse(list((self.home / ".local/bin").glob(".luna.*")))

    def test_custom_relative_checkout_and_piped_input(self):
        self.run_install("--install-dir=custom checkout", piped=True)
        selected = self.work / "custom checkout"
        self.assertEqual(self.commands("luna")[0]["args"], ["self", "install", "--install-dir=custom checkout"])
        self.assertEqual(self.commands("luna")[0]["repo"], str(selected))

    def test_existing_yay_is_reused(self):
        (self.bin / "yay").symlink_to(self.mock)
        self.run_install()
        self.assertEqual(self.commands("makepkg"), [])

    def test_clean_existing_checkout_only_fast_forwards(self):
        self.checkout()
        self.run_install()
        commands = self.commands("git")
        fetch = next(item for item in commands if "fetch" in item["args"])
        self.assertEqual(fetch["args"][-4:], ["fetch", "--no-tags", "origin", "+refs/heads/master:refs/remotes/origin/master"])
        self.assertEqual(commands[-1]["args"][-5:],
                         ["merge", "--ff-only", "--no-autostash", "--no-overwrite-ignore", "refs/remotes/origin/master"])
        self.assertFalse(any("clone" in item["args"] and REPO_URL in item["args"] for item in commands))

    def test_unrelated_dirty_or_untracked_checkout_is_rejected(self):
        for state in ({"origin": "https://example.com/other.git"}, {"changes": " M file"},
                      {"changes": "?? personal"}):
            with self.subTest(state=state):
                if not self.managed.exists():
                    self.checkout()
                self.env["BOOTSTRAP_GIT"] = json.dumps(state)
                self.log.unlink(missing_ok=True)
                self.run_install(success=False)
                self.assertEqual(self.commands("bun"), [])
                self.assertEqual(self.commands("luna"), [])

    def test_directory_links_and_parent_components_are_resolved(self):
        (self.home / "linked").symlink_to(self.work, target_is_directory=True)
        for destination, selected in ((str(self.home / "linked/repo"), self.work / "repo"),
                                      (str(self.home / "../repo"), self.root / "repo")):
            with self.subTest(destination=destination):
                self.log.unlink(missing_ok=True)
                self.run_install("--install-dir", destination)
                self.assertEqual(self.commands("luna")[0]["repo"], str(selected))
                self.assertEqual(self.commands("luna")[0]["args"], ["self", "install", "--install-dir", destination])

    def test_existing_empty_directory_is_used_for_checkout(self):
        self.managed.mkdir(parents=True)
        self.run_install()
        self.assertTrue((self.managed / ".git").is_dir())

    def test_missing_home_and_nested_directories_are_created(self):
        self.home.rmdir()
        self.run_install()
        self.assertTrue((self.home / ".local/bin/luna").is_file())
        self.assertTrue((self.managed / "src/luna-cli").is_dir())

    def test_invalid_tmpdir_uses_fallback(self):
        self.env["TMPDIR"] = str(self.root / "missing/tmp")
        self.run_install()
        self.assertTrue((self.home / ".local/bin/luna").is_file())
        yay_clone = next(item for item in self.commands("git") if "https://aur.archlinux.org/yay.git" in item["args"])
        self.assertFalse(Path(yay_clone["args"][-1]).parent.exists())

    def test_nonempty_checkout_directory_keeps_its_contents(self):
        self.managed.mkdir(parents=True)
        personal = self.managed / ".personal"
        personal.write_text("keep me")
        self.run_install(success=False)
        self.assertEqual(personal.read_text(), "keep me")
        self.assertEqual(self.commands("bun"), [])

    def test_file_in_directory_path_is_not_replaced(self):
        destination = self.work / "personal"
        destination.write_text("keep me")
        self.run_install("--install-dir", str(destination / "checkout"), success=False)
        self.assertEqual(destination.read_text(), "keep me")
        self.assertEqual(self.commands("sudo"), [])

    def test_failed_clone_leaves_empty_destination_and_removes_staging(self):
        (self.bin / "yay").symlink_to(self.mock)
        self.env["BOOTSTRAP_GIT_FAIL"] = "clone"
        self.run_install(success=False)
        self.assertEqual(list(self.managed.iterdir()), [])
        self.assertEqual(list(self.managed.parent.glob(".luna-clone.*")), [])
        self.assertEqual(len([item for item in self.commands("git") if "clone" in item["args"]]), 3)

    def test_transient_git_and_bun_download_failures_are_retried(self):
        (self.bin / "yay").symlink_to(self.mock)
        for operation in ("git:ls-remote", "git:clone", "mise:use"):
            with self.subTest(operation=operation):
                self.log.unlink(missing_ok=True)
                Path(self.env["BOOTSTRAP_ONCE_MARKER"]).unlink(missing_ok=True)
                self.env["BOOTSTRAP_FAIL_ONCE"] = operation
                result = self.run_install("--install-dir=" + str(self.work / operation))
                self.assertTrue(self.commands("luna"))
                self.assertNotIn("discard this failed attempt", result.stdout + result.stderr)
                name, action = operation.split(":")
                self.assertGreaterEqual(len([item for item in self.commands(name) if action in item["args"]]), 2)

    def test_transient_fetch_failure_is_retried(self):
        self.checkout()
        self.env["BOOTSTRAP_FAIL_ONCE"] = "git:fetch"
        self.run_install()
        self.assertEqual(len([item for item in self.commands("git") if "fetch" in item["args"]]), 2)

    def test_files_added_during_clone_are_not_overwritten(self):
        self.env["BOOTSTRAP_RACE_DEST"] = str(self.managed)
        self.run_install(success=False)
        self.assertEqual((self.managed / ".personal").read_text(), "keep me")
        self.assertFalse((self.managed / ".git").exists())
        self.assertEqual(list(self.managed.parent.glob(".luna-clone.*")), [])

    def test_bad_flags_do_not_change_system(self):
        for args in (("--repo", str(self.work)), ("--install-dir",), ("--install-dir=",),
                     ("--ref",), ("--ref=",), ("--help",), ("--unexpected",)):
            self.run_install(*args, success=False)
        self.assertEqual(self.commands(), [])

    def test_latest_resolves_the_remote_default_branch(self):
        self.env["BOOTSTRAP_GIT"] = json.dumps({"default": "main"})
        self.run_install("--ref=latest")
        self.assertIn("main", self.commands("git")[-1]["args"])
        self.assertEqual(self.commands("luna")[0]["args"], ["self", "install", "--ref=latest"])

    def test_explicit_branch_or_tag_is_cloned_without_default_lookup(self):
        for ref in ("feature/new-cli", "v1.2.3"):
            with self.subTest(ref=ref):
                self.log.unlink(missing_ok=True)
                self.run_install("--install-dir", str(self.work / ref), "--ref=" + ref)
                self.assertIn(ref, self.commands("git")[-1]["args"])
                self.assertFalse(any("--symref" in item["args"] for item in self.commands("git")))
                self.assertEqual(self.commands("luna")[0]["args"],
                                 ["self", "install", "--install-dir", str(self.work / ref), "--ref=" + ref])

    def test_existing_checkout_switches_to_remote_branch(self):
        self.checkout(refs={"feature/cli": "heads"})
        self.run_install("--ref", "feature/cli")
        switch = next(item for item in self.commands("git") if "switch" in item["args"])
        self.assertEqual(switch["args"][-4:], ["--no-track", "-c", "feature/cli", "refs/remotes/origin/feature/cli"])

    def test_tag_uses_detached_checkout(self):
        self.checkout(refs={"v1.2.3": "tags"})
        self.run_install("--ref=v1.2.3")
        self.assertEqual(self.commands("git")[-1]["args"][-4:],
                         ["switch", "--no-overwrite-ignore", "--detach", "refs/tags/v1.2.3"])

    def test_branch_wins_over_tag_with_same_name(self):
        self.checkout(refs={"stable": "both"})
        self.run_install("--ref=stable")
        self.assertIn("refs/remotes/origin/stable", self.commands("git")[-1]["args"])

    def test_unreferenced_detached_commit_is_preserved(self):
        self.checkout(detached=True, head="b" * 40)
        result = self.run_install(success=False)
        self.assertIn("unreferenced detached commit", result.stderr)
        self.assertFalse(any("switch" in item["args"] for item in self.commands("git")))

    def test_missing_ref_or_default_stops_before_build(self):
        self.checkout(refs={})
        self.run_install("--ref=missing", success=False)
        self.assertEqual(self.commands("bun"), [])
        self.env["BOOTSTRAP_GIT"] = json.dumps({"missing_default": True})
        self.run_install(success=False)
        self.assertEqual(self.commands("bun"), [])

    def test_malformed_refs_fail_before_system_changes(self):
        for ref in ("../bad", "-bad", "branch..name", "bad name", "x.lock", "x@{1}"):
            with self.subTest(ref=ref):
                self.run_install("--ref=" + ref, success=False)
                self.assertEqual(self.commands(), [])

    def test_failed_checkout_inspection_or_fast_forward_stops_before_build(self):
        self.checkout()
        for command in ("status", "fetch", "merge"):
            with self.subTest(command=command):
                self.log.unlink(missing_ok=True)
                self.env["BOOTSTRAP_GIT_FAIL"] = command
                self.run_install(success=False)
                self.assertEqual(self.commands("bun"), [])

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

    def test_dependency_build_failure_stops_cli_build_and_preserves_installed_cli(self):
        binary = self.home / ".local/bin/luna"
        binary.parent.mkdir(parents=True)
        binary.write_text("previous executable")
        for package in ("packages/luna-logger", "packages/luna-api"):
            with self.subTest(package=package):
                self.log.unlink(missing_ok=True)
                self.env["BOOTSTRAP_BUILD_FAIL"] = package
                result = self.run_install(success=False)
                self.assertEqual(result.returncode, 17)
                self.assertEqual(binary.read_text(), "previous executable")
                self.assertNotIn(["run", "--cwd", "src/luna-cli", "build"],
                                 [item["args"] for item in self.commands("bun")])
                self.assertEqual(self.commands("luna"), [])

    def test_cli_failure_is_propagated(self):
        self.env["BOOTSTRAP_FAIL"] = "luna"
        result = self.run_install(success=False)
        self.assertEqual(result.returncode, 17)
        self.assertIn("simulated failure diagnostics", result.stderr)

    def test_interrupt_during_pause_prints_runnable_recovery_command(self):
        self.env["BOOTSTRAP_CANCEL"] = str(signal.SIGINT)
        args = ["--install-dir=" + str(self.work / "manual ' checkout"), "--ref=feature/new-cli"]
        result = self.run_install(*args, success=False, piped=True)
        self.assertEqual(result.returncode, 130)
        self.assertIn("Other settings are not configured", result.stdout)
        self.assertEqual(self.commands("luna"), [])
        recovery = result.stdout.split("To finish, run:\n", 1)[1].strip()
        resumed = subprocess.run([str(self.bin / "bash"), "-c", recovery], env=self.env,
                                 capture_output=True, text=True, timeout=5)
        self.assertEqual(resumed.returncode, 0, resumed.stderr)
        self.assertEqual(self.commands("luna")[0]["args"], ["self", "install", *args])

    def test_termination_during_pause_skips_setup(self):
        self.env["BOOTSTRAP_CANCEL"] = str(signal.SIGTERM)
        result = self.run_install(success=False)
        self.assertEqual(result.returncode, 143)
        self.assertIn("To finish, run:", result.stdout)
        self.assertEqual(self.commands("luna"), [])


if __name__ == "__main__":
    unittest.main()
