"""Translate lsblk and the preset into archinstall 4.5's native JSON format."""

import json
from pathlib import Path
import sys
import uuid

MIB = 1024 ** 2


def unused_disk(disk):
    """Reject live media, mounted partitions, swap, and active device mappings."""
    def unused(node):
        return (node["type"] in ("disk", "part")
                and not any(node.get("mountpoints", []))
                and all(unused(child) for child in node.get("children", [])))

    return (disk["type"] == "disk" and not disk["ro"]
            and disk["size"] >= 16 * 1024 ** 3
            and disk["log-sec"] in (512, 4096) and unused(disk))


def selected_disk(devices, path):
    matches = [disk for disk in devices["blockdevices"]
               if disk["path"] == path and unused_disk(disk)]
    if len(matches) != 1:
        raise ValueError("Select an unused whole disk of at least 16 GiB")
    # Rechecked immediately before archinstall, including hotplug identity.
    return {key: matches[0].get(key) for key in (
        "path", "size", "log-sec", "maj:min", "serial", "wwn", "model")}


def configuration(disk):
    def size(value):
        return {"value": value, "unit": "MiB",
                "sector_size": {"value": disk["log-sec"], "unit": "B"}}

    def partition(start, length, filesystem, mountpoint, flags):
        return {"obj_id": str(uuid.uuid4()), "status": "create", "type": "primary",
                "dev_path": None, "fs_type": filesystem, "mountpoint": mountpoint,
                "mount_options": [], "flags": flags, "btrfs": [],
                "start": size(start), "size": size(length)}

    return {
        "hostname": "luna", "timezone": "Asia/Kathmandu", "ntp": True,
        "locale_config": {"kb_layout": "us", "sys_lang": "en_US", "sys_enc": "UTF-8"},
        "kernels": ["linux"], "firmware_optdeps": ["sof-firmware"],
        "bootloader_config": {"bootloader": "Systemd-boot", "uki": False, "removable": False},
        "network_config": {"type": "nm"},
        "swap": {"enabled": True, "algorithm": "zstd"},
        "pacman_config": {"parallel_downloads": 5, "color": True},
        "app_config": {"audio_config": {"audio": "pipewire"}},
        "packages": ["hyprland", "kitty", "sddm", "xorg-server", "mesa",
                     "qt6-declarative", "qt6-svg", "noto-fonts", "ttf-dejavu",
                     "xdg-desktop-portal-hyprland", "xdg-desktop-portal-gtk",
                     "polkit-kde-agent", "git", "mise", "curl", "nano", "reflector"],
        "disk_config": {
            "config_type": "default_layout",
            "device_modifications": [{"device": disk["path"], "wipe": True, "partitions": [
                partition(1, 1024, "fat32", "/boot", ["boot", "esp"]),
                # Leave space at both ends for GPT on 512-byte and 4K disks.
                partition(1025, disk["size"] // MIB - 1026, "ext4", "/", []),
            ]}],
        },
    }


def verify_mounts(devices, disk, target):
    matches = [item for item in devices["blockdevices"] if item["path"] == disk["path"]]
    if len(matches) != 1 or any(matches[0].get(key) != value for key, value in disk.items()):
        raise ValueError("The selected disk changed during installation")
    partitions = matches[0].get("children", [])
    for mountpoint in (target, target + "/boot"):
        if not any(part["type"] == "part" and mountpoint in part.get("mountpoints", [])
                   for part in partitions):
            raise ValueError("archinstall did not mount the expected target partitions")


def greeter_settings(response):
    if not response.get("succes"):
        raise ValueError("Could not resolve Luna's default login theme")
    theme = response["data"]
    return {
        "screen": {"name": "default"},
        "wallpaper": {"source": "", "type": "image", "fit": "fill",
                      "background_color": theme["colors"]["background"]},
        "colors": theme["colors"], "appearance": theme["appearance"],
        "fonts": {"ui": "Noto Sans", "mono": "monospace"},
    }


def main():
    action, *args = sys.argv[1:]
    if action == "list":
        for disk in json.load(sys.stdin)["blockdevices"]:
            if unused_disk(disk):
                print(f'{disk["path"]}  {disk["size"] / 1024**3:.1f} GiB  '
                      f'{disk.get("model", "")}  {disk.get("serial", "")}')
    elif action == "select":
        print(json.dumps(selected_disk(json.load(sys.stdin), args[0])))
    elif action == "configure":
        staging, username, sudo = Path(args[0]), args[1], args[2] == "yes"
        disk = json.loads((staging / "disk.json").read_text())
        credentials = {"users": [{"username": username, "sudo": sudo, "groups": [],
                                  "enc_password": (staging / "user.hash").read_text().strip()}]}
        if not sudo:
            credentials["root_enc_password"] = (staging / "root.hash").read_text().strip()
        (staging / "config.json").write_text(json.dumps(configuration(disk)))
        (staging / "credentials.json").write_text(json.dumps(credentials))
    elif action == "verify":
        verify_mounts(json.load(sys.stdin), json.loads(Path(args[0]).read_text()), args[1])
    elif action == "greeter":
        print(".pragma library\nvar values = " + json.dumps(greeter_settings(json.load(sys.stdin))) + ";")
    else:
        raise ValueError("Unknown configuration action")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError) as error:
        sys.exit(f"arch-install: {error}")
