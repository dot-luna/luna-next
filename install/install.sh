#!/usr/bin/env bash
set -euo pipefail

fail() {
    printf 'install: %s\n' "$*" >&2
    exit 1
}

usage() {
    printf '%s\n' 'Usage: install/install.sh [--ref BRANCH_OR_TAG]'
}

repo_ref=master
while (( $# > 0 )); do
    case "$1" in
        --ref)
            (( $# >= 2 )) || fail '--ref requires a branch or tag name.'
            repo_ref=$2
            shift 2
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *) fail "Unknown argument: $1. Use --help for usage." ;;
    esac
done

# Reject malformed names before package authentication; Git validates the full ref later.
[[ -n "$repo_ref" && "$repo_ref" != -* && "$repo_ref" != /* && "$repo_ref" != */ && "$repo_ref" != *. ]] || fail 'Invalid branch or tag name.'
[[ "$repo_ref" != *[[:space:][:cntrl:]~^:?\*\[\\]* && "$repo_ref" != *..* && "$repo_ref" != *'@{'* && "$repo_ref" != *//* ]] || fail 'Invalid branch or tag name.'
IFS=/ read -r -a ref_parts <<< "$repo_ref"
for ref_part in "${ref_parts[@]}"; do
    [[ "$ref_part" != .* && "$ref_part" != *.lock ]] || fail 'Invalid branch or tag name.'
done

# These destinations belong to the installer, never to the checkout that ran it.
(( EUID != 0 )) || fail 'Run as your normal user, without sudo.'
[[ "${HOME:-}" == /* && "$HOME" != / && -d "$HOME" ]] || fail 'HOME must be an existing absolute user home directory.'
repo_url=https://github.com/dot-luna/luna-next.git
repo_root="$HOME/.local/src/luna-next"
config_root=${XDG_CONFIG_HOME:-"$HOME/.config"}
[[ "$config_root" == /* ]] || fail 'XDG_CONFIG_HOME must be absolute.'

require_directory_path() {
    local current=/ part
    local -a parts
    [[ "$1" != *$'\n'* ]] || fail 'Directory paths must not contain newlines.'
    IFS=/ read -r -a parts <<< "$1"
    for part in "${parts[@]}"; do
        [[ -z "$part" || "$part" == . ]] && continue
        [[ "$part" != .. ]] || fail "Parent path components are not allowed: $1"
        current="${current%/}/$part"
        [[ ! -L "$current" ]] || fail "Refusing a symlinked directory: $current"
        [[ ! -e "$current" || -d "$current" ]] || fail "Expected a directory: $current"
    done
}

require_directory_path "$repo_root"
require_directory_path "$config_root/environment.d"
environment_file="$config_root/environment.d/60-luna-next.conf"
[[ ! -L "$environment_file" && ( ! -e "$environment_file" || -f "$environment_file" ) ]] || fail "Expected a regular environment file: $environment_file"
for tool in pacman sudo; do
    command -v "$tool" >/dev/null 2>&1 || fail "$tool is required (Arch Linux)."
done

export LUNA_NEXT_ROOT="$repo_root"
export PATH="$HOME/.local/bin:$PATH"

printf 'Updating system packages...\n'
sudo pacman -Syu --noconfirm
printf 'Installing Git, mise, and compiler tools...\n'
sudo pacman -S --needed --noconfirm -- git gcc mise
git check-ref-format "refs/heads/$repo_ref" || fail 'Invalid branch or tag name.'

if [[ -e "$repo_root" ]]; then
    [[ -d "$repo_root/.git" && ! -L "$repo_root/.git" ]] || fail "The managed destination is not a standalone Git checkout: $repo_root"
    actual_root=$(git -C "$repo_root" rev-parse --show-toplevel) || fail 'Cannot inspect the managed checkout.'
    [[ "$actual_root" == "$(cd -- "$repo_root" && pwd -P)" ]] || fail 'The managed destination must be its Git repository root.'
    origin=$(git -C "$repo_root" remote get-url origin) || fail 'The managed checkout needs an origin remote.'
    [[ "$origin" == "$repo_url" || "$origin" == "${repo_url%.git}" ]] || fail "The managed checkout has a different origin: $origin"
    changes=$(git -C "$repo_root" status --porcelain --untracked-files=normal)
    [[ -z "$changes" ]] || fail 'The managed checkout has local changes; commit or move them before installing.'
    current_commit=
    retained_refs=
    if ! git -C "$repo_root" symbolic-ref --quiet --short HEAD >/dev/null; then
        current_commit=$(git -C "$repo_root" rev-parse --verify 'HEAD^{commit}')
        # Inspect before fetching: refreshing a tag can move the ref retaining HEAD.
        retained_refs=$(git -C "$repo_root" for-each-ref --contains "$current_commit" --format='%(refname)' refs/heads refs/remotes refs/tags)
    fi
    printf 'Updating the managed Luna checkout...\n'
    remote_refs=$(git -C "$repo_root" ls-remote --refs origin "refs/heads/$repo_ref" "refs/tags/$repo_ref") || fail 'Cannot inspect the requested remote ref.'
    ref_kind=
    while read -r _ remote_ref; do
        if [[ "$remote_ref" == "refs/heads/$repo_ref" ]]; then
            ref_kind=branch
            break
        elif [[ "$remote_ref" == "refs/tags/$repo_ref" ]]; then
            ref_kind=tag
        fi
    done <<< "$remote_refs"
    [[ -n "$ref_kind" ]] || fail "No remote branch or tag named $repo_ref."
    if [[ "$ref_kind" == branch ]]; then
        selected_ref="refs/remotes/origin/$repo_ref"
        git -C "$repo_root" fetch --no-tags origin "+refs/heads/$repo_ref:$selected_ref"
    else
        selected_ref="refs/tags/$repo_ref"
        git -C "$repo_root" fetch --no-tags origin "+refs/tags/$repo_ref:$selected_ref"
    fi

    # Leaving detached HEAD must not discard a commit retained by no other ref.
    if [[ -n "$current_commit" && -z "$retained_refs" ]]; then
        selected_commit=$(git -C "$repo_root" rev-parse --verify "$selected_ref^{commit}")
        [[ "$current_commit" == "$selected_commit" ]] || fail 'The detached checkout has an unreferenced commit; save it on a branch before installing.'
    fi
    if [[ "$ref_kind" == branch ]]; then
        if git -C "$repo_root" show-ref --verify --quiet "refs/heads/$repo_ref"; then
            git -C "$repo_root" switch --no-overwrite-ignore --no-guess "$repo_ref"
        else
            git -C "$repo_root" switch --no-overwrite-ignore --no-track -c "$repo_ref" "$selected_ref"
        fi
        git -C "$repo_root" merge --ff-only --no-autostash --no-overwrite-ignore "$selected_ref"
    else
        git -C "$repo_root" switch --no-overwrite-ignore --detach "$selected_ref"
    fi
else
    printf 'Cloning Luna into %s...\n' "$repo_root"
    mkdir -p -- "${repo_root%/*}"
    git clone --branch "$repo_ref" --single-branch -- "$repo_url" "$repo_root"
fi

printf 'Installing Rust...\n'
# The home context does not require the checkout's mise tasks or toolchain yet.
mise --cd "$HOME" use --global --yes --fuzzy -- rust@stable
printf 'Building and installing luna...\n'
mise --cd "$HOME" exec rust@stable -- cargo install --locked --force \
    --path "$repo_root/src/ln-cli" --root "$HOME/.local"

mkdir -p -- "$config_root/environment.d"
staged_environment=$(mktemp "$config_root/environment.d/.60-luna-next.conf.XXXXXX")
trap 'rm -f -- "$staged_environment"' EXIT
printf '%s\n' 'LUNA_NEXT_ROOT=${HOME}/.local/src/luna-next' 'PATH=${HOME}/.local/bin:${PATH}' > "$staged_environment"
chmod 600 "$staged_environment"
mv -f -- "$staged_environment" "$environment_file"
trap - EXIT

# Login sessions read environment.d; refresh an existing user manager as well.
if command -v systemctl >/dev/null 2>&1; then
    if ! systemctl --user import-environment LUNA_NEXT_ROOT PATH 2>/dev/null; then
        printf 'No user service manager is available; the environment applies at next login.\n'
    fi
fi
printf 'Luna installed. Run %s setup to configure the system.\n' "$HOME/.local/bin/luna"
