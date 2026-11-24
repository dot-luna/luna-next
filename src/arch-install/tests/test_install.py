"""Use temporary files and shell command doubles; never run real disk operations."""

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "src/arch-install/src"
spec = importlib.util.spec_from_file_location("preset", SOURCE / "config.py")
preset = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preset)


def disk(**values):
    return dict({"path": "/dev/test-disk", "type": "disk", "size": 32 * 1024**3,
                 "log-sec": 512, "ro": False, "maj:min": "8:0", "serial": "test",
                 "model": "test disk", "wwn": "id", "mountpoints": [None]}, **values)


class PresetTests(unittest.TestCase):
    def test_excludes_busy_disks_and_live_media(self):
        for node in (
            disk(ro=True), disk(size=8 * 1024**3), disk(type="loop"),
            disk(mountpoints=["/run/archiso/bootmnt"]),
            disk(children=[{"type": "part", "mountpoints": ["[SWAP]"]}]),
            disk(children=[{"type": "part", "mountpoints": [None],
                            "children": [{"type": "crypt", "mountpoints": [None]}]}]),
        ):
            with self.subTest(node=node):
                self.assertFalse(preset.unused_disk(node))
                with self.assertRaises(ValueError):
                    preset.selected_disk({"blockdevices": [node]}, node["path"])

    def test_layout_fits_512_and_4096_byte_disks(self):
        for sector in (512, 4096):
            node = disk(**{"log-sec": sector})
            config = preset.configuration(node)
            parts = config["disk_config"]["device_modifications"][0]["partitions"]
            boot, root = parts
            self.assertEqual((boot["fs_type"], boot["mountpoint"]), ("fat32", "/boot"))
            self.assertEqual((root["fs_type"], root["mountpoint"]), ("ext4", "/"))
            end = (root["start"]["value"] + root["size"]["value"]) * preset.MIB
            self.assertLessEqual(end, node["size"] - 34 * sector)
            self.assertEqual(root["size"]["sector_size"]["value"], sector)
            self.assertNotIn("disk_encryption", config["disk_config"])
            self.assertIn("hyprland", config["packages"])
            self.assertIn("kitty", config["packages"])
            self.assertIn("sddm", config["packages"])
            self.assertEqual(config["network_config"]["type"], "nm")
            self.assertEqual(config["timezone"], "Asia/Kathmandu")

    def test_postflight_requires_both_partitions_on_same_disk(self):
        node = disk(children=[{"type": "part", "mountpoints": ["/mnt/luna"]},
                              {"type": "part", "mountpoints": ["/mnt/luna/boot"]}])
        identity = preset.selected_disk({"blockdevices": [disk()]}, node["path"])
        preset.verify_mounts({"blockdevices": [node]}, identity, "/mnt/luna")
        for changed in (disk(), dict(node, serial="replaced"),
                        dict(node, children=node["children"][:1])):
            with self.assertRaises(ValueError):
                preset.verify_mounts({"blockdevices": [changed]}, identity, "/mnt/luna")


class ShellTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="luna-arch-tests-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.env = dict(os.environ, TEST_ROOT=str(self.root), TEST_SOURCE=str(SOURCE))
        self.identity = preset.selected_disk({"blockdevices": [disk()]}, "/dev/test-disk")
        (self.root / "disk.json").write_text(json.dumps(self.identity) + "\n")
        (self.root / "inventory.json").write_text(json.dumps({"blockdevices": [disk()]}))
        (self.root / "events").touch()

    def shell(self, code, input="", success=True):
        result = subprocess.run(["bash", "-c", 'source "$TEST_SOURCE/install.sh"\n'
                                 'staging=$TEST_ROOT\nhelper=$TEST_SOURCE/config.py\n' + code],
                                env=self.env, input=input, text=True, capture_output=True, timeout=15)
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def test_cancel_and_exact_disk_confirmation(self):
        code = 'disk=/dev/test-disk; username=tester; sudo_access=yes; confirm_install'
        self.shell(code, "yes\n", success=False)
        self.shell(code, "ERASE /dev/another-disk\n", success=False)
        self.shell(code, "ERASE /dev/test-disk\n")

    def test_password_retries_and_hashes_without_echo(self):
        result = self.shell('password_hash tester "$staging/user.hash"',
                            "secret-one\nwrong\nsecret-two\nsecret-two\n")
        self.assertNotIn("secret", result.stdout + result.stderr)
        password_hash = (self.root / "user.hash").read_text().strip()
        self.assertTrue(password_hash.startswith("$6$"))
        expected = subprocess.check_output(["openssl", "passwd", "-6", "-salt",
                                            password_hash.split("$")[2], "-stdin"],
                                           input="secret-two\n", text=True).strip()
        self.assertEqual(password_hash, expected)

    def test_non_sudo_user_requires_separate_root_credentials(self):
        self.shell('umask 077; disk=/dev/test-disk; username=tester; '
                   'inventory() { cat "$staging/inventory.json"; }; collect_details',
                   "n\nuser-secret\nuser-secret\nroot-secret\nroot-secret\n")
        credentials = json.loads((self.root / "credentials.json").read_text())
        self.assertFalse(credentials["users"][0]["sudo"])
        self.assertIn("root_enc_password", credentials)
        self.assertNotEqual(credentials["root_enc_password"], credentials["users"][0]["enc_password"])
        self.assertEqual((self.root / "credentials.json").stat().st_mode & 0o777, 0o600)

    def install_attempt(self, inventory, fail_dry_run=False, fail_install=False):
        (self.root / "inventory.json").write_text(json.dumps({"blockdevices": [inventory]}))
        (self.root / "target.sh").write_text('configure_target() { echo target >> "$staging/events"; }\n')
        self.env.update(DRY_FAILURE="1" if fail_dry_run else "0",
                        INSTALL_FAILURE="1" if fail_install else "0")
        return self.shell('''
disk=/dev/test-disk; target=/mnt/luna; source_dir=$TEST_ROOT; log=$TEST_ROOT/log
inventory() { cat "$staging/inventory.json"; }
install() { echo mirrors >> "$staging/events"; }
archinstall() {
    if [[ " $* " == *" --dry-run "* ]]; then
        echo dry-run >> "$staging/events"
        return "$DRY_FAILURE"
    fi
    echo erase >> "$staging/events"
    return "$INSTALL_FAILURE"
}
perform_installation
''', success=False)

    def test_dry_run_failure_prevents_erase(self):
        self.install_attempt(disk(), fail_dry_run=True)
        self.assertEqual((self.root / "events").read_text(), "dry-run\n")

    def test_disk_replacement_prevents_erase(self):
        self.install_attempt(disk(serial="another"))
        self.assertEqual((self.root / "events").read_text(), "dry-run\n")

    def test_mounting_disk_after_selection_prevents_erase(self):
        self.install_attempt(disk(mountpoints=["/mnt/other"]))
        self.assertEqual((self.root / "events").read_text(), "dry-run\n")

    def test_failed_install_never_configures_target(self):
        self.install_attempt(disk(), fail_install=True)
        self.assertEqual((self.root / "events").read_text(), "dry-run\nmirrors\nerase\n")

    def test_zero_exit_without_install_never_configures_target(self):
        self.install_attempt(disk())
        self.assertEqual((self.root / "events").read_text(), "dry-run\nmirrors\nerase\n")

    def test_success_configures_only_after_mount_verification(self):
        installed = disk(children=[{"type": "part", "mountpoints": ["/mnt/luna"]},
                                   {"type": "part", "mountpoints": ["/mnt/luna/boot"]}])
        (self.root / "mounted.json").write_text(json.dumps({"blockdevices": [installed]}))
        (self.root / "target.sh").write_text('configure_target() { echo target >> "$staging/events"; }\n')
        self.shell('''
disk=/dev/test-disk; target=/mnt/luna; source_dir=$TEST_ROOT; log=$TEST_ROOT/log
inventory() { cat "$staging/inventory.json"; }
install() { echo mirrors >> "$staging/events"; }
archinstall() {
    if [[ " $* " == *" --dry-run "* ]]; then
        echo dry-run >> "$staging/events"
    else
        echo erase >> "$staging/events"
        cp "$staging/mounted.json" "$staging/inventory.json"
    fi
}
perform_installation
''')
        self.assertEqual((self.root / "events").read_text(), "dry-run\nmirrors\nerase\ntarget\n")

    def test_target_keeps_cli_checkout_theme_and_enabled_services(self):
        repository = self.root / "repository"
        repository.mkdir()
        (repository / "source").write_text("Luna checkout\n")
        for args in (["init", "-q"], ["add", "source"],
                     ["-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                      "commit", "-qm", "fixture"]):
            subprocess.run(["git", "-C", str(repository), *args], check=True, capture_output=True)
        (repository / "target").mkdir()
        (repository / "target/luna").write_text("#!/bin/sh\necho fixture-version\n")
        target = self.root / "target"
        for name in ("etc/arch-release", "etc/fstab", "boot/vmlinuz-linux", "boot/initramfs-linux.img",
                     "usr/share/wayland-sessions/hyprland.desktop"):
            path = target / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.touch()
        (self.root / "greeter/screen").mkdir(parents=True)
        (self.root / "greeter/Settings.js").write_text(".pragma library\nvar values = {};\n")
        (self.root / "greeter/screen/Screen.qml").write_text("import QtQuick\nItem {}\n")
        (self.root / "config.json").write_text("{}")
        (self.root / "mirrorlist").write_text("Server = https://mirror.example/$repo/os/$arch\n")
        self.shell('''
umask 077
target=$TEST_ROOT/target; repository=$TEST_ROOT/repository; username=tester
arch-chroot() {
    printf '%s\\n' "$*" >> "$staging/events"
    if [[ $2 == getent ]]; then printf 'tester:x:1000:1000::/home/tester:/bin/bash\\n'; fi
}
chown() { printf 'chown %s\\n' "$*" >> "$staging/events"; }
source "$TEST_SOURCE/target.sh"
configure_target
''')
        installed_home = target / "home/tester"
        self.assertTrue(os.access(installed_home / ".local/bin/luna", os.X_OK))
        self.assertEqual((installed_home / ".local/src/luna-next/source").read_text(), "Luna checkout\n")
        origin = subprocess.check_output(["git", "-C", str(installed_home / ".local/src/luna-next"),
                                          "remote", "get-url", "origin"], text=True)
        self.assertEqual(origin.strip(), "https://github.com/dot-luna/luna-next.git")
        self.assertEqual((target / "etc/profile.d/luna.sh").stat().st_mode & 0o777, 0o644)
        self.assertEqual((target / "etc/sddm.conf.d/luna.conf").read_text(), "[Theme]\nCurrent=luna\n")
        self.assertIn("Session=hyprland.desktop", (target / "var/lib/sddm/state.conf").read_text())
        self.assertEqual((target / "usr/share/sddm/themes/luna/Settings.js").stat().st_mode & 0o777, 0o644)
        events = (self.root / "events").read_text()
        self.assertIn("systemctl enable NetworkManager sddm reflector.timer", events)
        self.assertIn("systemctl set-default graphical.target", events)
        self.assertNotIn("--now", events)
        self.assertNotIn("self install", events)

    def test_cleanup_after_main_returns_removes_credentials(self):
        self.shell('staging=$TEST_ROOT/private; mkdir "$staging"; '
                   'touch "$staging/credentials.json"; trap cleanup EXIT; true')
        self.assertFalse((self.root / "private").exists())

    def test_help_and_live_iso_guard_do_not_install(self):
        result = subprocess.run(["bash", str(ROOT / "arch-install.sh"), "--help"],
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0)
        self.assertIn("Usage:", result.stdout)
        self.shell('preflight', success=False)


if __name__ == "__main__":
    unittest.main()
