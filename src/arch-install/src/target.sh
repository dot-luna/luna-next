#!/usr/bin/env bash
# Called only after the target mountpoints have been verified against the selected disk.
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
    install -d -m755 "$target/etc/xdg/reflector" "$target/etc/sddm.conf.d" "$target/etc/profile.d"
    printf '%s\n' '--protocol https' '--latest 20' '--sort rate' '--save /etc/pacman.d/mirrorlist' \
        > "$target/etc/xdg/reflector/reflector.conf"
    printf '%s\n' 'export PATH="$HOME/.local/bin:$PATH"' > "$target/etc/profile.d/luna.sh"

    install -d -m755 "$target$home/.local/bin" "$target$home/.local/src"
    install -m755 "$repository/target/luna" "$target$home/.local/bin/luna"
    git clone --no-local "$repository" "$target$home/.local/src/luna-next"
    git -C "$target$home/.local/src/luna-next" remote set-url origin https://github.com/dot-luna/luna-next.git
    chown -R "$uid:$gid" "$target$home/.local"
    arch-chroot "$target" "$home/.local/bin/luna" --version

    install -d -m755 "$target/usr/share/sddm/themes/luna"
    cp -r "$staging/greeter/." "$target/usr/share/sddm/themes/luna/"
    chmod -R a+rX "$target/usr/share/sddm/themes/luna"
    printf '[Theme]\nCurrent=luna\n' > "$target/etc/sddm.conf.d/luna.conf"
    install -d -m755 "$target/var/lib/sddm"
    printf '[Last]\nSession=hyprland.desktop\nUser=%s\n' "$username" > "$target/var/lib/sddm/state.conf"
    arch-chroot "$target" chown -R sddm:sddm /var/lib/sddm
    # New system services are enabled, never started in the live session.
    arch-chroot "$target" systemctl enable NetworkManager sddm reflector.timer
    arch-chroot "$target" systemctl set-default graphical.target
    arch-chroot "$target" systemctl is-enabled NetworkManager sddm reflector.timer
    chmod 644 "$target/etc/xdg/reflector/reflector.conf" "$target/etc/profile.d/luna.sh" \
        "$target/etc/sddm.conf.d/luna.conf" "$target/var/lib/sddm/state.conf"
    install -d -m700 "$target/var/log/luna-arch-install"
    install -m600 "$staging/config.json" "$target/var/log/luna-arch-install/preset.json"
}
