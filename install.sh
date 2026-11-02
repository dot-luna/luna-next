#!/usr/bin/env bash
# Bootstrap Luna on Arch Linux as a normal user with sudo access.
# The CLI owns desktop setup; this script only prepares its package sources and binary.
set -euo pipefail

fail() {
    printf 'install: %s\n' "$*" >&2
    exit 1
}

repo_url=https://github.com/dot-luna/luna-next.git
repo_root="${HOME:?HOME must be set}/.local/src/luna-next"
repo_ref=latest
while (( $# > 0 )); do
    case "$1" in
        --install-dir|--ref)
            (( $# >= 2 )) && [[ -n "$2" && "$2" != -* ]] || fail "$1 requires a value."
            if [[ "$1" == --install-dir ]]; then repo_root=$2; else repo_ref=$2; fi
            shift 2
            ;;
        --install-dir=*)
            repo_root=${1#*=}
            [[ -n "$repo_root" ]] || fail '--install-dir requires a path.'
            shift
            ;;
        --ref=*)
            repo_ref=${1#*=}
            [[ -n "$repo_ref" ]] || fail '--ref requires a branch, tag, or latest.'
            shift
            ;;
        *) fail "Unknown argument: $1" ;;
    esac
done

# Reject malformed refs before system changes. Git validates the full ref once installed.
[[ -n "$repo_ref" && "$repo_ref" != -* && "$repo_ref" != /* && "$repo_ref" != */ && "$repo_ref" != *. ]] || fail 'Invalid branch or tag name.'
[[ "$repo_ref" != *[[:space:][:cntrl:]~^:?\*\[\\]* && "$repo_ref" != *..* && "$repo_ref" != *'@{'* && "$repo_ref" != *//* ]] || fail 'Invalid branch or tag name.'
IFS=/ read -r -a ref_parts <<< "$repo_ref"
for ref_part in "${ref_parts[@]}"; do
    [[ "$ref_part" != .* && "$ref_part" != *.lock ]] || fail 'Invalid branch or tag name.'
done

# 1. Validate destinations before requesting privileges or changing the system.
(( EUID != 0 )) || fail 'Run as your normal user, without sudo.'
[[ "$HOME" == /* && "$HOME" != / && -d "$HOME" ]] || fail 'HOME must be an existing absolute user home directory.'
[[ "$repo_root" == /* ]] || repo_root="$PWD/$repo_root"

require_directory_path() {
    local current=/ part
    local -a parts
    [[ "$1" != *[[:cntrl:]]* ]] || fail 'Paths must not contain control characters.'
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
require_directory_path "$HOME/.local/bin"
for tool in pacman sudo; do
    command -v "$tool" >/dev/null 2>&1 || fail "$tool is required; prepare an Arch Linux user with sudo access first."
done

# 2. Keep successful tool output quiet, but show the failed command's diagnostics.
temporary=$(mktemp -d)
staged_cli=
pause_pid=
cleanup() {
    if [[ -n "$pause_pid" ]]; then
        kill -- "$pause_pid" 2>/dev/null || true
        wait "$pause_pid" 2>/dev/null || true
    fi
    rm -rf -- "$temporary"
    [[ -z "$staged_cli" ]] || rm -f -- "$staged_cli"
    return 0
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
run() {
    local status
    if "$@" >"$temporary/output" 2>&1; then
        return 0
    else
        status=$?
        cat -- "$temporary/output" >&2
        printf 'install: Command failed: %s\n' "$1" >&2
        return "$status"
    fi
}

# 3. Refresh pacman's configured repositories with a full upgrade, then install
# only bootstrap tools. base-devel supplies makepkg and the compiler used for yay.
sudo -v
printf 'Updating system packages...\n'
run sudo pacman -Syu --needed --noconfirm -- base-devel ca-certificates curl git mise sudo

# 4. Prepare the AUR source by building yay as the user, never as root.
# Existing pacman mirrors and Git identity stay under the user's control.
if ! command -v yay >/dev/null 2>&1; then
    printf 'Installing yay...\n'
    run git clone --depth 1 -- https://aur.archlinux.org/yay.git "$temporary/yay"
    (
        cd -- "$temporary/yay"
        run makepkg --syncdeps --install --needed --noconfirm
    )
fi

# 5. Use mise's global Bun tool so both the build and later CLI hooks can use it.
# Resolve outside the checkout so project mise tasks do not require a trust prompt.
printf 'Installing Bun...\n'
run mise --cd "$HOME" use --global --yes bun@latest
bun_path=$(mise --cd "$HOME" which bun)
export PATH="${bun_path%/*}:$HOME/.local/bin:$PATH"

# 6. Resolve latest from Git's advertised default branch, then keep the selected
# branch or tag in a persistent checkout. Existing branches only fast-forward.
if [[ "$repo_ref" == latest ]]; then
    remote_head=$(git ls-remote --symref "$repo_url" HEAD)
    repo_ref=
    while read -r marker target _; do
        if [[ "$marker" == ref: && "$target" == refs/heads/* ]]; then
            repo_ref=${target#refs/heads/}
            break
        fi
    done <<< "$remote_head"
    [[ -n "$repo_ref" ]] || fail 'Cannot resolve the remote default branch.'
fi
git check-ref-format "refs/heads/$repo_ref" || fail 'Invalid branch or tag name.'
if [[ -e "$repo_root" ]]; then
    [[ -d "$repo_root/.git" && ! -L "$repo_root/.git" ]] || fail "Expected a standalone Luna checkout: $repo_root"
    repo_root=$(cd -- "$repo_root" && pwd -P)
    [[ "$(git -C "$repo_root" rev-parse --show-toplevel)" == "$repo_root" ]] || fail 'The checkout must be its Git repository root.'
    origin=$(git -C "$repo_root" remote get-url origin)
    [[ "$origin" == "$repo_url" || "$origin" == "${repo_url%.git}" || "$origin" == git@github.com:dot-luna/luna-next.git ]] || fail 'The checkout has a different origin.'
    changes=$(git -C "$repo_root" status --porcelain --untracked-files=normal)
    [[ -z "$changes" ]] || fail 'The checkout has local changes; commit or move them before installing.'
    detached_commit=
    retained_refs=
    if ! git -C "$repo_root" symbolic-ref --quiet HEAD >/dev/null; then
        detached_commit=$(git -C "$repo_root" rev-parse --verify 'HEAD^{commit}')
        # Inspect before a tag fetch can move the only ref retaining this commit.
        retained_refs=$(git -C "$repo_root" for-each-ref --contains "$detached_commit" --format='%(refname)' refs/heads refs/remotes refs/tags)
    fi
    printf 'Updating Luna...\n'
    remote_refs=$(git -C "$repo_root" ls-remote --refs origin "refs/heads/$repo_ref" "refs/tags/$repo_ref")
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
        run git -C "$repo_root" fetch --no-tags origin "+refs/heads/$repo_ref:$selected_ref"
    else
        selected_ref="refs/tags/$repo_ref"
        run git -C "$repo_root" fetch --no-tags origin "+refs/tags/$repo_ref:$selected_ref"
    fi
    if [[ -n "$detached_commit" && -z "$retained_refs" ]]; then
        selected_commit=$(git -C "$repo_root" rev-parse --verify "$selected_ref^{commit}")
        [[ "$detached_commit" == "$selected_commit" ]] || fail 'Save the unreferenced detached commit on a branch before installing.'
    fi
    if [[ "$ref_kind" == branch ]]; then
        if git -C "$repo_root" show-ref --verify --quiet "refs/heads/$repo_ref"; then
            run git -C "$repo_root" switch --no-overwrite-ignore --no-guess "$repo_ref"
        else
            run git -C "$repo_root" switch --no-overwrite-ignore --no-track -c "$repo_ref" "$selected_ref"
        fi
        run git -C "$repo_root" merge --ff-only --no-autostash --no-overwrite-ignore "$selected_ref"
    else
        run git -C "$repo_root" switch --no-overwrite-ignore --detach "$selected_ref"
    fi
else
    printf 'Cloning Luna...\n'
    mkdir -p -- "${repo_root%/*}"
    run git clone --branch "$repo_ref" --single-branch -- "$repo_url" "$repo_root"
    repo_root=$(cd -- "$repo_root" && pwd -P)
fi
export LUNA_NEXT_ROOT="$repo_root"

# 7. Build the Bun CLI using the committed lockfile. Stage beside the destination
# so a failed build or copy leaves the installed executable intact.
printf 'Building Luna CLI...\n'
(
    cd -- "$repo_root"
    run bun install --frozen-lockfile
    run bun run --cwd src/ln-cli build
)
mkdir -p -- "$HOME/.local/bin"
staged_cli=$(mktemp "$HOME/.local/bin/.luna.XXXXXX")
run install -m755 -- "$repo_root/target/luna-bun" "$staged_cli"
mv -fT -- "$staged_cli" "$HOME/.local/bin/luna"
staged_cli=

# 8. Give the user five seconds to stop before the CLI configures the rest.
# Signal handlers preserve the exact checkout in a shell-safe recovery command.
cancel_handoff() {
    printf '\nSetup cancelled. Other settings are not configured. To finish, run:\n'
    printf '  %q --repo %q self install\n' "$HOME/.local/bin/luna" "$repo_root"
    exit "$1"
}
trap 'cancel_handoff 130' INT
trap 'cancel_handoff 143' TERM
printf 'Starting luna self install in 5 seconds. Press Ctrl+C to cancel...\n'
# Waiting for a background sleep lets Bash handle signals immediately, including
# when the installer itself is read from a curl pipe.
sleep 5 &
pause_pid=$!
wait "$pause_pid"
pause_pid=
trap 'exit 130' INT
trap 'exit 143' TERM
printf 'Configuring Luna...\n'
"$HOME/.local/bin/luna" --repo "$repo_root" self install
