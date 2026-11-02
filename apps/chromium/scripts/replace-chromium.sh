#!/usr/bin/env bash
# Replace Arch's Chromium package with Ungoogled Chromium before Luna installs the app.
# Run as the normal user: bash apps/chromium/scripts/replace-chromium.sh
#
# Steps:
# 1. Detect the exact installed package; do nothing when Arch's chromium is absent.
# 2. Ask yay to replace it with ungoogled-chromium-bin in one package transaction.
#    --ask 4 accepts the package conflict without removing dependencies or browser data.
# 3. Verify that the replacement owns Chromium's existing command and desktop launcher.
#
# The replacement ships /usr/bin/chromium, /usr/lib/chromium/chromium, chromedriver,
# and chromium.desktop. Existing shortcuts and CLI calls to those paths use the new
# browser automatically; no profile-specific flags are added to the system launcher.

set -euo pipefail

installed=$(pacman -Qq -- chromium 2>/dev/null || true)
if [[ "$installed" != chromium ]]; then
  exit 0
fi

if (( EUID == 0 )); then
  printf '%s\n' 'Run this script as your normal user; yay handles package privileges.' >&2
  exit 1
fi

command -v yay >/dev/null
yay -S --needed --noconfirm --ask 4 -- ungoogled-chromium-bin

for path in /usr/bin/chromium /usr/bin/chromedriver /usr/lib/chromium/chromium /usr/share/applications/chromium.desktop; do
  owner=$(pacman -Qoq -- "$path")
  if [[ "$owner" != ungoogled-chromium-bin ]]; then
    printf 'Ungoogled Chromium does not own the expected path: %s\n' "$path" >&2
    exit 1
  fi
done
