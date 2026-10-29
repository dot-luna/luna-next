#!/usr/bin/env bash
set -euo pipefail

fail() {
    printf 'setup: %s\n' "$*" >&2
    exit 1
}

(( EUID != 0 )) || fail 'Run as your normal user, without sudo.'
[[ "${HOME:-}" == /* && "$HOME" != / ]] || fail 'HOME must be an absolute user home directory.'
for tool in pacman sudo; do
    command -v "$tool" >/dev/null 2>&1 || fail "$tool is required (Arch Linux)."
done
repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)

printf 'Updating system packages...\n'
sudo pacman -Syu --noconfirm

printf 'Installing mise and compiler tools...\n'
sudo pacman -S --needed --noconfirm -- gcc mise

printf 'Installing Rust...\n'
# Use the home context before the repository's mise tasks and Rust toolchain exist.
mise --cd "$HOME" use --global --yes --fuzzy -- rust@stable

printf 'Building and installing lnxt...\n'
mise --cd "$HOME" exec rust@stable -- cargo install --locked --force \
    --path "$repo_dir/src/ln-cli" --root "$HOME/.local"

printf 'Running lnxt setup in 5 seconds...\n'
sleep 5
cd -- "$repo_dir"
exec "$HOME/.local/bin/lnxt" setup
