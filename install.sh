#!/usr/bin/env bash
# Bootstrap Luna on Arch Linux as a normal user with sudo access.
# Usage: bash install.sh [--repo PATH]
# The CLI owns desktop setup; this script only prepares its package sources and binary.
set -euo pipefail

fail() {
    printf 'install: %s\n' "$*" >&2
    exit 1
}

repo_url=https://github.com/dot-luna/luna-next.git
repo_root="${HOME:?HOME must be set}/.local/src/luna-next"
while (( $# > 0 )); do
    case "$1" in
        --repo)
            (( $# >= 2 )) && [[ -n "$2" && "$2" != -* ]] || fail '--repo requires a path.'
            repo_root=$2
            shift 2
            ;;
        --help|-h)
            printf '%s\n' 'Usage: bash install.sh [--repo PATH]' \
                'Default checkout: ~/.local/src/luna-next' \
                'Installs the CLI, then runs luna self install after a five-second pause.'
            exit 0
            ;;
        *) fail "Unknown argument: $1. Use --help for usage." ;;
    esac
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

# 6. Keep a persistent checkout for app sources. Reruns only fast-forward clean
# Luna checkouts tracking origin; unrelated repositories and edits are rejected.
if [[ -e "$repo_root" ]]; then
    [[ -d "$repo_root/.git" && ! -L "$repo_root/.git" ]] || fail "Expected a standalone Luna checkout: $repo_root"
    repo_root=$(cd -- "$repo_root" && pwd -P)
    [[ "$(git -C "$repo_root" rev-parse --show-toplevel)" == "$repo_root" ]] || fail 'The checkout must be its Git repository root.'
    origin=$(git -C "$repo_root" remote get-url origin)
    [[ "$origin" == "$repo_url" || "$origin" == "${repo_url%.git}" || "$origin" == git@github.com:dot-luna/luna-next.git ]] || fail 'The checkout has a different origin.'
    changes=$(git -C "$repo_root" status --porcelain --untracked-files=normal)
    [[ -z "$changes" ]] || fail 'The checkout has local changes; commit or move them before installing.'
    upstream=$(git -C "$repo_root" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}') || fail 'The checkout must track an origin branch.'
    [[ "$upstream" == origin/* ]] || fail 'The checkout must track an origin branch.'
    printf 'Updating Luna...\n'
    run git -C "$repo_root" fetch origin
    run git -C "$repo_root" merge --ff-only --no-autostash "$upstream"
else
    printf 'Cloning Luna...\n'
    mkdir -p -- "${repo_root%/*}"
    run git clone -- "$repo_url" "$repo_root"
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
