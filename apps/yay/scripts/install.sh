#!/usr/bin/env bash
# Build and install yay from the Git clone selected by Luna.
set -euo pipefail

# Hooks start in the app folder; makepkg needs the cloned PKGBUILD instead.
cd -- "${LUNA_GIT_APP_CLONE_DIR:?LUNA_GIT_APP_CLONE_DIR must be set}/yay"
exec makepkg --syncdeps --install --rmdeps --clean --needed --noconfirm
