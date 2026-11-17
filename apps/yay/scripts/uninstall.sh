#!/usr/bin/env bash
# The Git build installs a pacman package; leave shared dependencies installed.
set -euo pipefail
if pacman -Qq -- yay >/dev/null; then
    sudo pacman -R --noconfirm -- yay
else
    result=$?
    [[ "$result" == 1 ]] || exit "$result"
fi
