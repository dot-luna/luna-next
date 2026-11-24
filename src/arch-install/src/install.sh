#!/usr/bin/env bash
# archinstall owns partitioning and base installation; this script supplies the preset.
set -euo pipefail
set +x

fail() { printf 'arch-install: %s\n' "$*" >&2; exit 1; }
inventory() {
    lsblk --json --bytes --paths --output PATH,TYPE,SIZE,MODEL,SERIAL,WWN,RO,MAJ:MIN,LOG-SEC,MOUNTPOINTS
}

preflight() {
    (( EUID == 0 )) && [[ -d /run/archiso ]] || fail 'Run as root in the official Arch live ISO.'
    [[ $(uname -m) == x86_64 && -d /sys/firmware/efi/efivars ]] || fail 'Boot the x86_64 ISO in UEFI mode.'
    [[ -t 0 && -t 1 ]] || fail 'An interactive terminal is required.'
    local command version
    for command in archinstall python3 lsblk arch-chroot reflector openssl flock git findmnt; do
        command -v "$command" >/dev/null || fail "Missing $command; use a current Arch ISO."
    done
    version=$(archinstall --version)
    [[ $version =~ ^archinstall\ 4\.5(\.[0-9]+)?$ ]] || fail "Supported archinstall version: 4.5.x; found $version."
    [[ -x $repository/target/luna && -d $repository/.git ]] || fail 'Run install.sh first to build the CLI in this checkout.'
    [[ -z $(git -C "$repository" status --porcelain --untracked-files=normal) ]] || fail 'The Luna checkout must be clean so it can be copied into the new system.'
    [[ ! -L $target && ! -e $target || -d $target && ! -L $target && -z $(ls -A "$target") ]] || fail "$target must be an empty directory, not a symlink."
    if findmnt --raw --noheadings --output TARGET | grep -Eq "^$target(/|$)"; then
        fail "$target is already mounted. Unmount it before starting another installation."
    fi
}

password_hash() {
    local label=$1 destination=$2 password repeated
    while true; do
        IFS= read -rs -p "$label password: " password || return 1
        printf '\n'
        IFS= read -rs -p 'Repeat password: ' repeated || return 1
        printf '\n'
        if [[ -n $password && $password == "$repeated" ]]; then break; fi
        printf 'Passwords must match and cannot be empty.\n'
    done
    # A shell builtin feeds stdin: plaintext never reaches argv, environment, or logs.
    printf '%s\n' "$password" | openssl passwd -6 -stdin > "$destination"
    unset password repeated
}

ask_yes_no() {
    local answer
    while true; do
        IFS= read -r -p "$1" answer || return 1
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
    python3 "$helper" list < "$staging/devices.json"
    if [[ -z $disk ]]; then
        IFS= read -r -p 'Whole disk to erase (for example /dev/nvme0n1): ' disk
    fi
    python3 "$helper" select "$disk" < "$staging/devices.json" > "$staging/disk.json"
    if [[ -z $username ]]; then
        IFS= read -r -p 'Username [jrtilak]: ' username
        username=${username:-jrtilak}
    fi
    [[ $username =~ ^[a-z_][a-z0-9_-]{0,31}$ && $username != root ]] || fail 'Use a normal Linux username (lowercase letters, digits, underscore, hyphen).'
    sudo_access=no
    if ask_yes_no 'Allow this user to use sudo? [Y/n]: ' yes; then sudo_access=yes; fi
    password_hash "$username" "$staging/user.hash"
    if [[ $sudo_access == no ]]; then password_hash root "$staging/root.hash"; fi
    python3 "$helper" configure "$staging" "$username" "$sudo_access"
}

prepare_assets() {
    mkdir "$staging/theme-home" "$staging/greeter"
    # Explicit theme paths avoid inheriting any live user's selected theme.
    "$repository/target/luna" theme --config-file "$staging/theme-home/selection.jsonc" \
        --library-dir "$staging/theme-home/themes" get --json |
        python3 "$helper" greeter > "$staging/greeter/Settings.js"
    cp "$repository"/src/luna-login/src/greeter/*.qml "$staging/greeter/"
    cp -r "$repository/src/luna-login/src/screens/default" "$staging/greeter/screen"
    sed 's/^Theme-Id=.*/Theme-Id=luna/' "$repository/src/luna-login/src/greeter/metadata.desktop" \
        > "$staging/greeter/metadata.desktop"
    printf 'Selecting HTTPS package mirrors…\n'
    reflector --protocol https --latest 20 --sort rate > "$staging/mirrorlist"
    grep -Eq '^Server = https://.*\$repo.*\$arch' "$staging/mirrorlist" || fail 'No usable package mirrors; check the live ISO network.'
}

confirm_install() {
    local confirmation
    printf '\nErase ALL data on: %s\nUser: %s (sudo: %s)\n' "$disk" "$username" "$sudo_access"
    printf '%s\n' 'UEFI · systemd-boot · Linux · ext4 · no encryption · zram' \
        'English · US keyboard · Asia/Kathmandu · hostname luna' \
        'Hyprland · Kitty · Luna SDDM login · NetworkManager · PipeWire' \
        'Luna CLI will be copied into the installed system. Full Luna setup stays manual.'
    IFS= read -r -p "Type ERASE $disk to install: " confirmation || return 1
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
    inventory | python3 "$helper" select "$disk" > "$staging/current-disk.json"
    cmp -s "$staging/disk.json" "$staging/current-disk.json" || fail 'Disk identity changed; refusing to erase it.'
    install -m 644 "$staging/mirrorlist" /etc/pacman.d/mirrorlist
    archinstall "${args[@]}" 2>&1 | tee -a "$log"
    inventory | python3 "$helper" verify "$staging/disk.json" "$target"
    # Postflight must pass before copying anything into a target path.
    source "$source_dir/target.sh"
    configure_target 2>&1 | tee -a "$log"
}

main() {
    local source_dir disk= username= sudo_access target=/mnt/luna
    # EXIT runs after main returns, so cleanup state must outlive its local scope.
    staging= log=
    source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
    local repository helper
    repository=$(cd "$source_dir/../../.." && pwd -P)
    helper=$source_dir/config.py
    while (( $# )); do
        case $1 in
            --disk|--username)
                (( $# >= 2 )) && [[ -n $2 && $2 != -* ]] || fail "$1 requires a value."
                if [[ $1 == --disk ]]; then disk=$2; else username=$2; fi
                shift 2 ;;
            --help|-h)
                printf 'Usage: bash arch-install.sh [--disk /dev/DEVICE] [--username NAME]\nRun in the Arch live ISO after install.sh. Always asks before erasing a whole disk.\n'
                return ;;
            *) fail "Unknown argument: $1" ;;
        esac
    done
    preflight
    umask 077
    exec 9>/run/luna-arch-install.lock
    flock --nonblock 9 || fail 'Another Luna Arch installer is running.'
    staging=$(mktemp -d /run/luna-arch-install.XXXXXX)
    trap cleanup EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    collect_details
    prepare_assets
    if ! confirm_install; then printf 'Installation cancelled.\n'; return; fi
    log=$(mktemp /var/log/luna-arch-install.XXXXXX.log)
    perform_installation
    install -m600 "$log" "$target/var/log/luna-arch-install/install.log"
    rm -f "$staging/credentials.json" "$staging/user.hash" "$staging/root.hash"
    printf '\nArch is installed. Log in, open Kitty with Super+Q, then run: luna self install\n'
    if [[ $sudo_access == no ]]; then printf 'Full Luna setup requires sudo; the root password lets you grant it later.\n'; fi
    if ask_yes_no 'Reboot now? [y/N]: ' no; then
        sync
        umount -R "$target"
        systemctl reboot
    fi
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then main "$@"; fi
