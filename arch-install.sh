#!/usr/bin/env bash
# Standalone Arch installer. No Luna CLI, source checkout, or full desktop setup required.
#
# Boot the official x86_64 Arch ISO in UEFI mode and connect to the internet.
# Run as root from a terminal:
#   curl -fsSL https://raw.githubusercontent.com/dot-luna/luna-next/dev/arch-install.sh | bash
# Or download this file, inspect it, then run:
#   bash arch-install.sh [--disk /dev/nvme0n1] [--username jrtilak]
#
# Requires archinstall 4.5.x and the standard ISO tools. Prompts read /dev/tty,
# so piping the script through Bash works. No unattended erase flag is provided.
# Asks for disk, username (jrtilak), sudo access (yes), password and confirmation.
# Without sudo, also asks for a root password. Type ERASE /dev/DEVICE to proceed.
#
# Defaults: one whole disk (at least 16 GiB), GPT, 1 GiB FAT32 /boot, ext4 /,
# no encryption, UEFI/systemd-boot, Linux, CPU microcode/firmware, zram/zstd,
# en_US.UTF-8, US keyboard, Asia/Kathmandu, hostname luna, NetworkManager,
# PipeWire, Hyprland, Kitty, and SDDM's built-in login screen enabled at boot.
# Pacman uses official repositories, five parallel downloads, HTTPS mirrors,
# and weekly Reflector refresh. Git, curl, Nano, fonts and portals are included.
# After login, Super+Q opens Kitty. For Wi-Fi, reconnect with nmtui; live ISO
# credentials are not copied. Install the Luna CLI and full Luna setup separately.
#
# Existing partitions, dual boot, encryption, RAID/LVM, Secure Boot enrollment,
# and proprietary NVIDIA driver selection are outside this preset.
# Mounted disks, swap and active mappings are rejected; disk identity is rechecked.
# Failures stop without retrying destructive operations or rebooting. Inspect
# /var/log/archinstall and the printed log before retrying; disk changes may exist.
# Temporary credential files are removed on exit. Archinstall retains private hashes.
# A successful install asks whether to reboot and saves logs under
# /var/log/luna-arch-install in the new system. Full VM/reboot testing is still needed.
#
# Reference: github.com/archlinux/archinstall/tree/4.5 and Arch's Installation_guide.
# Compared archfi and Omarchy ISO for coverage; their code is not copied.
# Checks: bash -n arch-install.sh
#         python3 -m unittest discover -s __tests__/arch_install -v
set -euo pipefail
set +x

fail() { printf 'arch-install: %s\n' "$*" >&2; exit 1; }
inventory() {
    lsblk --tree --json --bytes --paths --output PATH,TYPE,SIZE,MODEL,SERIAL,WWN,RO,MAJ:MIN,LOG-SEC,MOUNTPOINTS
}

preflight() {
    (( EUID == 0 )) && [[ -d /run/archiso ]] || fail 'Run as root in the official Arch live ISO.'
    [[ $(uname -m) == x86_64 && -d /sys/firmware/efi/efivars ]] || fail 'Boot the x86_64 ISO in UEFI mode.'
    [[ -t 1 && -r /dev/tty ]] || fail 'An interactive terminal is required.'
    local command version
    for command in archinstall python3 lsblk arch-chroot reflector openssl flock findmnt getent; do
        command -v "$command" >/dev/null || fail "Missing $command; use a current Arch ISO."
    done
    version=$(archinstall --version)
    [[ $version =~ ^archinstall\ 4\.5(\.[0-9]+)?$ ]] || fail "Supported archinstall version: 4.5.x; found $version."
    [[ ! -L $target && ! -e $target || -d $target && ! -L $target && -z $(ls -A "$target") ]] || fail "$target must be an empty directory, not a symlink."
    if findmnt --raw --noheadings --output TARGET | grep -Eq "^$target(/|$)"; then
        fail "$target is already mounted. Unmount it before starting another installation."
    fi
}

password_hash() {
    local label=$1 destination=$2 password repeated
    while true; do
        IFS= read -rs -u 3 -p "$label password: " password || return 1
        printf '\n'
        IFS= read -rs -u 3 -p 'Repeat password: ' repeated || return 1
        printf '\n'
        if [[ -n $password && $password == "$repeated" ]]; then break; fi
        printf 'Passwords must match and cannot be empty.\n'
    done
    # A shell builtin feeds stdin: plaintext never reaches argv, environment, or logs.
    (umask 077; printf '%s\n' "$password" | openssl passwd -6 -stdin > "$destination")
    unset password repeated
}

ask_yes_no() {
    local answer
    while true; do
        IFS= read -r -u 3 -p "$1" answer || return 1
        case ${answer,,} in
            y|yes) return 0 ;;
            n|no) return 1 ;;
            '') [[ $2 == yes ]]; return ;;
        esac
        printf 'Enter yes or no.\n'
    done
}

collect_details() {
    inventory > "$staging/devices.json"
    native_config list "$staging/devices.json"
    if [[ -z $disk ]]; then
        IFS= read -r -u 3 -p 'Whole disk to erase (for example /dev/nvme0n1): ' disk
    fi
    native_config select "$disk" "$staging/devices.json" > "$staging/disk.json"
    if [[ -z $username ]]; then
        IFS= read -r -u 3 -p 'Username [jrtilak]: ' username
        username=${username:-jrtilak}
    fi
    [[ $username =~ ^[a-z_][a-z0-9_-]{0,31}$ && $username != root ]] || fail 'Use a normal Linux username (lowercase letters, digits, underscore, hyphen).'
    if getent passwd "$username" >/dev/null || [[ $username == sddm || $username == polkitd ]]; then
        fail 'That username belongs to a system account; choose another name.'
    fi
    sudo_access=no
    if ask_yes_no 'Allow this user to use sudo? [Y/n]: ' yes; then sudo_access=yes; fi
    password_hash "$username" "$staging/user.hash"
    if [[ $sudo_access == no ]]; then password_hash root "$staging/root.hash"; fi
    (umask 077; native_config configure "$staging" "$username" "$sudo_access")
}

prepare_mirrors() {
    printf 'Selecting HTTPS package mirrors…\n'
    reflector --protocol https --latest 20 --sort rate > "$staging/mirrorlist"
    grep -Eq '^Server = https://.*\$repo.*\$arch' "$staging/mirrorlist" || fail 'No usable package mirrors; check the live ISO network.'
}

confirm_install() {
    local confirmation
    printf '\nErase ALL data on: %s\nUser: %s (sudo: %s)\n' "$disk" "$username" "$sudo_access"
    printf '%s\n' 'UEFI · systemd-boot · Linux · ext4 · no encryption · zram' \
        'English · US keyboard · Asia/Kathmandu · hostname luna' \
        'Hyprland · Kitty · SDDM login · NetworkManager · PipeWire'
    IFS= read -r -u 3 -p "Type ERASE $disk to install: " confirmation || return 1
    [[ $confirmation == "ERASE $disk" ]]
}

cleanup() {
    local status=$?
    [[ -z ${staging:-} ]] || rm -rf -- "$staging"
    if (( status != 0 )); then
        printf 'Installation stopped. Logs: /var/log/archinstall and %s\n' "${log:-not started}" >&2
        printf 'Disk changes may already exist. Inspect them before running the installer again.\n' >&2
    fi
}

perform_installation() {
    local args=(--config "$staging/config.json" --creds "$staging/credentials.json"
        --mountpoint "$target" --silent --skip-version-check)
    archinstall "${args[@]}" --dry-run 2>&1 | tee -a "$log"
    inventory > "$staging/devices.json"
    native_config select "$disk" "$staging/devices.json" > "$staging/current-disk.json"
    cmp -s "$staging/disk.json" "$staging/current-disk.json" || fail 'Disk identity changed; refusing to erase it.'
    install -m 644 "$staging/mirrorlist" /etc/pacman.d/mirrorlist
    archinstall "${args[@]}" 2>&1 | tee -a "$log"
    inventory > "$staging/devices.json"
    native_config verify "$staging/disk.json" "$target" "$staging/devices.json"
    # Postflight must pass before copying anything into a target path.
    configure_target 2>&1 | tee -a "$log"
}

configure_target() {
    local account name ignored uid gid gecos home shell
    [[ -f $target/etc/arch-release && -f $target/etc/fstab && -f $target/boot/vmlinuz-linux ]] || fail 'The target installation is incomplete.'
    [[ -f $target/boot/initramfs-linux.img ]] || fail 'The Linux initramfs is missing.'
    arch-chroot "$target" bootctl --esp-path=/boot is-installed || fail 'systemd-boot was not installed.'
    arch-chroot "$target" visudo --check
    [[ -f $target/usr/share/wayland-sessions/hyprland.desktop ]] || fail 'The Hyprland login session is missing.'
    account=$(arch-chroot "$target" getent passwd "$username")
    IFS=: read -r name ignored uid gid gecos home shell <<< "$account"
    [[ $name == "$username" && $uid =~ ^[0-9]+$ && $gid =~ ^[0-9]+$ && $uid -ge 1000 && $home == "/home/$username" ]] || fail 'The target user was not created correctly.'

    install -Dm644 "$staging/mirrorlist" "$target/etc/pacman.d/mirrorlist"
    install -d -m755 "$target/etc/xdg/reflector" "$target/etc/sddm.conf.d"
    printf '%s\n' '--protocol https' '--latest 20' '--sort rate' '--save /etc/pacman.d/mirrorlist' \
        > "$target/etc/xdg/reflector/reflector.conf"
    printf '[Theme]\nCurrent=\n' > "$target/etc/sddm.conf.d/arch-install.conf"
    install -d -m755 "$target/var/lib/sddm"
    printf '[Last]\nSession=hyprland.desktop\nUser=%s\n' "$username" > "$target/var/lib/sddm/state.conf"
    arch-chroot "$target" chown -R sddm:sddm /var/lib/sddm
    # New system services are enabled, never started in the live session.
    arch-chroot "$target" systemctl enable NetworkManager sddm reflector.timer
    arch-chroot "$target" systemctl set-default graphical.target
    arch-chroot "$target" systemctl is-enabled NetworkManager sddm reflector.timer
    chmod 644 "$target/etc/xdg/reflector/reflector.conf" \
        "$target/etc/sddm.conf.d/arch-install.conf" "$target/var/lib/sddm/state.conf"
    install -d -m700 "$target/var/log/luna-arch-install"
    install -m600 "$staging/config.json" "$target/var/log/luna-arch-install/preset.json"
}

# Python is supplied by archinstall; use it only for native JSON, not shell interpolation.
native_config() {
    python3 - "$@" <<'PY'
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
                     "git", "curl", "nano", "reflector"],
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


def main():
    action, *args = sys.argv[1:]
    if action == "list":
        for disk in json.loads(Path(args[0]).read_text())["blockdevices"]:
            if unused_disk(disk):
                print(f'{disk["path"]}  {disk["size"] / 1024**3:.1f} GiB  '
                      f'{disk.get("model", "")}  {disk.get("serial", "")}')
    elif action == "select":
        print(json.dumps(selected_disk(json.loads(Path(args[1]).read_text()), args[0])))
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
        verify_mounts(json.loads(Path(args[2]).read_text()), json.loads(Path(args[0]).read_text()), args[1])
    else:
        raise ValueError("Unknown configuration action")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError) as error:
        sys.exit(f"arch-install: {error}")
PY
}

main() {
    local disk= username= sudo_access target=/mnt/luna
    # EXIT runs after main returns, so cleanup state must outlive its local scope.
    staging= log=
    while (( $# )); do
        case $1 in
            --disk|--username)
                (( $# >= 2 )) && [[ -n $2 && $2 != -* ]] || fail "$1 requires a value."
                if [[ $1 == --disk ]]; then disk=$2; else username=$2; fi
                shift 2 ;;
            --help|-h)
                printf 'Usage: bash arch-install.sh [--disk /dev/DEVICE] [--username NAME]\nRun as root in the Arch live ISO. Always asks before erasing a whole disk.\n'
                return ;;
            *) fail "Unknown argument: $1" ;;
        esac
    done
    preflight
    exec 3<>/dev/tty
    umask 022
    exec 9>/run/luna-arch-install.lock
    flock --nonblock 9 || fail 'Another Luna Arch installer is running.'
    staging=$(mktemp -d /run/luna-arch-install.XXXXXX)
    trap cleanup EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    collect_details
    prepare_mirrors
    if ! confirm_install; then printf 'Installation cancelled.\n'; return; fi
    log=$(mktemp /var/log/luna-arch-install.XXXXXX.log)
    perform_installation
    install -m600 "$log" "$target/var/log/luna-arch-install/install.log"
    rm -f "$staging/credentials.json" "$staging/user.hash" "$staging/root.hash"
    printf '\nArch is installed. Log in and open Kitty with Super+Q.\n'
    if ask_yes_no 'Reboot now? [y/N]: ' no; then
        sync
        umount -R "$target"
        systemctl reboot
    fi
}

if [[ -z ${BASH_SOURCE[0]:-} || ${BASH_SOURCE[0]} == "$0" ]]; then main "$@"; fi
