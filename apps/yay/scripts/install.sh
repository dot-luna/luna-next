#!/usr/bin/env bash
# Build and install yay from the Git clone selected by Luna.
set -euo pipefail

# Build in Luna's disposable workspace so package artifacts cannot dirty the selected clone.
cd -- "${LUNA_GIT_APP_BUILD_DIR:?LUNA_GIT_APP_BUILD_DIR must be set}/yay"
exec makepkg --syncdeps --install --rmdeps --clean --needed --noconfirm
