# Arch installation

Run `bash arch-install.sh` from a bootstrapped Luna checkout in the official
x86_64 Arch live ISO. It requires UEFI, internet access, archinstall 4.5.x, and
an unused whole disk of at least 16 GiB. The checkout must be clean and contain
the CLI built by `install.sh`. There is no `luna arch-install` command.

```sh
bash arch-install.sh --disk /dev/nvme0n1 --username jrtilak
```

Both arguments are optional. The script lists usable disks and asks for the disk,
username (default `jrtilak`), sudo access (default yes), and password with repeat.
Declining sudo also requires a root password. Passwords are hidden and hashed
before being passed to archinstall. A summary requires typing `ERASE /dev/DEVICE`
before disk changes. Installation then runs automatically and asks whether to reboot.

## Defaults

| Setting           | Preset                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| Disk              | Erase one whole disk; GPT, 1 GiB FAT32 `/boot`, remaining space ext4 `/`                              |
| Boot              | UEFI, systemd-boot, standard Linux kernel, CPU microcode and firmware                                 |
| Encryption / swap | No encryption; zram with zstd                                                                         |
| Locale            | English UTF-8, US keyboard, Asia/Kathmandu, hostname `luna`                                           |
| Desktop           | Hyprland defaults, Kitty, Luna's Qt 6 SDDM login screen enabled                                       |
| Network / audio   | NetworkManager, PipeWire                                                                              |
| Packages          | Pacman official repositories, five parallel downloads, ranked HTTPS mirrors, weekly Reflector refresh |
| Utilities         | Git, mise, curl, Nano, desktop portals and fonts                                                      |

The CLI is copied to `~/.local/bin/luna` and the checkout to
`~/.local/src/luna-next` in the new system. Log in through SDDM, open Kitty with
**Super+Q**, and run `luna self install` for the full Luna setup. That command
requires sudo access. Yay, Luna's app catalog, and desktop customization remain
part of that later setup.

Ethernet uses NetworkManager's DHCP defaults. For Wi-Fi, reconnect with `nmtui`
after reboot; live ISO Wi-Fi credentials are not copied. Graphics use Mesa and
kernel drivers. Proprietary NVIDIA driver selection, Secure Boot enrollment,
dual boot, existing partitions, encryption, RAID, and LVM are outside this preset.

## Failures and checks

Mounted disks, active swap, device mappings, unsupported versions, and changed
disk identities stop installation. Failures stop without rebooting or retrying
disk operations. Inspect `/var/log/archinstall` and the printed Luna log path
before retrying. Successful installs retain the preset and Luna log under
`/var/log/luna-arch-install` in the new system. Temporary credential files are
removed on exit; archinstall retains its own root-readable credential hashes.

From the repository root:

```sh
for script in arch-install.sh install.sh src/arch-install/src/*.sh; do
  bash -n "$script" || exit
done
python3 -m unittest discover -s src/arch-install/tests -v
python3 -m unittest discover -s src/luna-login/tests -v
bun test __tests__/install.test.ts
```

Tests use temporary directories and command doubles; they do not partition disks.
A disposable UEFI VM installation and reboot are still required to validate the
complete installation on a real Arch ISO.

The preset follows [archinstall 4.5](https://github.com/archlinux/archinstall/tree/4.5)
and the [Arch installation guide](https://wiki.archlinux.org/title/Installation_guide).
[archfi](https://github.com/MatMoul/archfi) and
[Omarchy ISO](https://github.com/omacom/omarchy-iso) were compared for installation
coverage; their scripts are not copied.
