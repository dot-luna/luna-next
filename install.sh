#!/usr/bin/env bash
# Bootstrap the Luna CLI on Arch Linux, then let the CLI configure the desktop.
# Run as a normal user with working pacman, sudo access, and an internet connection.
#
# Flags (both --flag=value and --flag value work):
#   --install-dir=PATH  Source checkout. Default: $HOME/.local/src/luna-next.
#                       Relative paths start at the caller's working directory.
#   --ref=REF           Git branch or tag. Default: latest, meaning the newest
#                       commit on the remote default branch, not a release tag.
#                       A branch wins when a branch and tag share the same name.
#
# Examples:
#   bash install.sh
#   bash install.sh --install-dir="$HOME/projects/luna-next" --ref=master
#   bash install.sh --install-dir=./luna-next --ref=latest
#   curl -fsSL https://raw.githubusercontent.com/dot-luna/luna-next/master/install.sh | bash
#
# Source: https://github.com/dot-luna/luna-next.git
# CLI source: src/luna-cli inside the selected checkout.
# Binary: $HOME/.local/bin/luna; --install-dir changes only the source location.
#
# Bootstrap steps:
#   1. Resolve paths and create missing checkout/binary directories.
#   2. Upgrade Arch and install base-devel, ca-certificates, curl, git, mise, sudo.
#   3. Build and install yay through makepkg if it is not already available.
#   4. Install mise's global bun@latest and add it to this script's PATH.
#   5. Clone the selected Git ref, or safely update an existing Luna checkout.
#   6. Run bun install --frozen-lockfile at the checkout root, then
#      bun run --cwd packages/luna-api build and
#      bun run --cwd src/luna-cli build.
#      Each package must provide a build script; the CLI build must produce
#      target/luna-bun.
#   7. Publish that binary as ~/.local/bin/luna with executable permissions.
#   8. Wait five seconds, then hand the remaining setup to luna self install.
#
# Recovery: create missing directories, resolve directory links and '..', reuse
# empty checkout directories, and retry Git downloads and Bun installation up to
# three times. Clone into a private staging directory so an interrupted attempt
# does not leave a partial checkout at the selected destination. An unusable
# TMPDIR falls back to /tmp. Successful commands show only brief progress.
#
# Existing Luna branches switch to the requested ref, then run git pull --ff-only.
# Remote tags use detached HEAD without replacing local tags. Stop rather than
# overwrite unrelated folders, local edits, diverged history, or unreferenced
# commits. Missing privileges and failed required installs/builds also stop the
# script with diagnostics. Completed package installations are not rolled back.
# The previous CLI executable stays in place until its replacement is built and
# copied successfully. Temporary staging and yay build files are removed on exit;
# the source checkout and its CLI build artifacts remain for later operations.
#
# After building, wait five seconds before running luna self install with the
# exact original flags. Ctrl+C during the pause prints the command to finish
# later. The CLI owns all remaining configuration and must provide self install.
#
# Checks: bash -n install.sh; bun test __tests__/install.test.ts
set -euo pipefail

fail() {
    printf 'install: %s\n' "$*" >&2
    exit 1
}

repo_url=https://github.com/dot-luna/luna-next.git
repo_root="${HOME:?HOME must be set}/.local/src/luna-next"
repo_ref=latest
# Keep spelling, argument boundaries, and latest unchanged for the CLI even after
# parsing and resolving them for this script. Accept both --flag=value and --flag value.
cli_args=("$@")
while (( $# > 0 )); do
    case "$1" in
        --install-dir|--ref)
            (( $# >= 2 )) && [[ -n "$2" && "$2" != -* ]] || fail "$1 requires a value."
            if [[ "$1" == --install-dir ]]; then
                repo_root=$2
            else
                repo_ref=$2
            fi
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

# Reject malformed refs before system changes, even when Git is not installed yet.
# Slash-separated branch names are allowed; Git checks the full ref after installation.
[[ -n "$repo_ref" && "$repo_ref" != -* && "$repo_ref" != /* &&
    "$repo_ref" != */ && "$repo_ref" != *. ]] || fail 'Invalid branch or tag name.'
[[ "$repo_ref" != *[[:space:][:cntrl:]~^:?\*\[\\]* && "$repo_ref" != *..* &&
    "$repo_ref" != *'@{'* && "$repo_ref" != *//* ]] || fail 'Invalid branch or tag name.'
IFS=/ read -r -a ref_parts <<< "$repo_ref"
for ref_part in "${ref_parts[@]}"; do
    [[ "$ref_part" != .* && "$ref_part" != *.lock ]] || fail 'Invalid branch or tag name.'
done

# 1. Validate destinations before requesting privileges or changing the system.
(( EUID != 0 )) || fail 'Run as your normal user, without sudo.'
[[ "$HOME" == /* && "$(realpath -m -- "$HOME")" != / ]] || fail 'HOME must be an absolute non-root user home directory.'

# Resolve ordinary path aliases before creating missing directories. mkdir refuses
# file components and permission failures; existing directory links are harmless.
prepare_directory() {
    local directory
    [[ "$1" != *[[:cntrl:]]* ]] || fail 'Paths must not contain control characters.'
    directory=$(realpath -m -- "$1") || return
    [[ "$directory" != / ]] || fail 'The filesystem root is not an installation directory.'
    mkdir -p -- "$directory" || return
    printf '%s\n' "$directory"
}

repo_root=$(prepare_directory "$repo_root")
bin_dir=$(prepare_directory "$HOME/.local/bin")
for tool in pacman sudo; do
    command -v "$tool" >/dev/null 2>&1 || fail "$tool is required; prepare an Arch Linux user with sudo access first."
done

# 2. Keep successful tool output quiet, but show the failed command's diagnostics.
if ! temporary=$(mktemp -d 2>/dev/null); then
    temporary=$(mktemp -d /tmp/luna-install.XXXXXX)
fi
staged_cli=
staged_checkout=
pause_pid=
# Remove only this run's temporary files. Stop and reap the countdown if cancelled;
# cleanup succeeds even when the child or staged executable has already gone away.
cleanup() {
    if [[ -n "$pause_pid" ]]; then
        kill -- "$pause_pid" 2>/dev/null || true
        wait "$pause_pid" 2>/dev/null || true
    fi
    rm -rf -- "$temporary"
    [[ -z "$staged_cli" ]] || rm -f -- "$staged_cli"
    [[ -z "$staged_checkout" ]] || rm -rf -- "$staged_checkout"
    return 0
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Capture one command at a time, retaining its exit code and showing its output only
# on failure. The final CLI runs directly so its own output remains visible.
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

# Retry only repeatable downloads/tool installation, never Git switches or merges.
# Keep each attempt's output separate so captured ref queries receive only the
# successful result. Exhausted retries return the final diagnostics and exit code.
retry() {
    local attempt status
    for attempt in 1 2 3; do
        if "$@" >"$temporary/retry-output" 2>"$temporary/retry-error"; then
            cat -- "$temporary/retry-output"
            return 0
        else
            status=$?
        fi
        if (( attempt < 3 )); then
            printf 'Retrying %s (%s/3)...\n' "$1" "$((attempt + 1))" >&2
            sleep 1
        fi
    done
    cat -- "$temporary/retry-output"
    cat -- "$temporary/retry-error" >&2
    return "$status"
}

# 3. Refresh pacman's configured repositories with a full upgrade, then install
# only bootstrap tools. base-devel supplies makepkg and the compiler used for yay.
# Authenticate before hiding package output; sudo can prompt through the terminal.
sudo -v
printf 'Updating system packages...\n'
run sudo pacman -Syu --needed --noconfirm -- base-devel ca-certificates curl git mise sudo

# 4. Prepare the AUR source by building yay as the user, never as root.
# Existing pacman mirrors and Git identity stay under the user's control.
if ! command -v yay >/dev/null 2>&1; then
    printf 'Installing yay...\n'
    run retry git clone --depth 1 -- https://aur.archlinux.org/yay.git "$temporary/yay"
    (
        cd -- "$temporary/yay"
        run makepkg --syncdeps --install --needed --noconfirm
    )
fi

# 5. Use mise's global Bun tool so both the build and later CLI hooks can use it.
# Resolve outside the checkout so project mise tasks do not require a trust prompt.
printf 'Installing Bun...\n'
run retry mise --cd "$HOME" use --global --yes bun@latest
bun_path=$(mise --cd "$HOME" which bun)
# Make this Bun installation available immediately, without editing shell startup files.
export PATH="${bun_path%/*}:$bin_dir:$PATH"

# 6. Resolve latest from Git's advertised default branch, then keep the selected
# branch or tag in a persistent checkout. latest means the default branch's current
# commit, rather than a release tag. Existing branches only fast-forward.
if [[ "$repo_ref" == latest ]]; then
    remote_head=$(retry git ls-remote --symref "$repo_url" HEAD)
    repo_ref=
    while read -r marker target _; do
        if [[ "$marker" == ref: && "$target" == refs/heads/* ]]; then
            repo_ref=${target#refs/heads/}
            break
        fi
    done <<< "$remote_head"
    [[ -n "$repo_ref" ]] || fail 'Cannot resolve the remote default branch.'
fi
branch_ref="refs/heads/$repo_ref"
tag_ref="refs/tags/$repo_ref"
git check-ref-format "$branch_ref" || fail 'Invalid branch or tag name.'
if [[ -e "$repo_root/.git" || -L "$repo_root/.git" ]]; then
    # Reuse only a clean, standalone Luna checkout. Never reset or delete local edits.
    [[ -d "$repo_root/.git" && ! -L "$repo_root/.git" ]] || fail "Expected a standalone Luna checkout: $repo_root"
    repo_root=$(cd -- "$repo_root" && pwd -P)
    [[ "$(git -C "$repo_root" rev-parse --show-toplevel)" == "$repo_root" ]] || fail 'The checkout must be its Git repository root.'
    origin=$(git -C "$repo_root" remote get-url origin)
    [[ "$origin" == "$repo_url" || "$origin" == "${repo_url%.git}" || "$origin" == git@github.com:dot-luna/luna-next.git ]] || fail 'The checkout has a different origin.'
    changes=$(git -C "$repo_root" status --porcelain --untracked-files=normal)
    [[ -z "$changes" ]] || fail "There are local changes in $repo_root; commit or move them before installing."
    detached_commit=
    if ! git -C "$repo_root" symbolic-ref --quiet HEAD >/dev/null; then
        detached_commit=$(git -C "$repo_root" rev-parse --verify 'HEAD^{commit}')
    fi
    printf 'Updating Luna...\n'
    remote_refs=$(retry git -C "$repo_root" ls-remote --refs origin "$branch_ref" "$tag_ref")
    ref_kind=
    # Prefer a branch when a branch and a tag share the requested name.
    while read -r _ remote_ref; do
        if [[ "$remote_ref" == "$branch_ref" ]]; then
            ref_kind=branch
            break
        elif [[ "$remote_ref" == "$tag_ref" ]]; then
            ref_kind=tag
        fi
    done <<< "$remote_refs"
    [[ -n "$ref_kind" ]] || fail "No remote branch or tag named $repo_ref."
    # Fetch just the selected ref. FETCH_HEAD selects remote tags without replacing
    # any local tag that may be the only reference retaining a personal commit.
    if [[ "$ref_kind" == branch ]]; then
        selected_ref="refs/remotes/origin/$repo_ref"
        fetch_ref="+$branch_ref:$selected_ref"
    else
        selected_ref=FETCH_HEAD
        fetch_ref=$tag_ref
    fi
    run retry git -C "$repo_root" fetch --no-tags origin "$fetch_ref"
    if [[ -n "$detached_commit" ]]; then
        # A fetch can move a remote branch, so check references after it completes.
        # If none remain, keep HEAD on this commit unless the target is identical.
        retained_refs=$(git -C "$repo_root" for-each-ref --contains "$detached_commit" --format='%(refname)' refs/heads refs/remotes refs/tags)
        if [[ -z "$retained_refs" ]]; then
            selected_commit=$(git -C "$repo_root" rev-parse --verify "$selected_ref^{commit}")
            [[ "$detached_commit" == "$selected_commit" ]] || fail 'Save the unreferenced detached commit on a branch before installing.'
        fi
    fi
    if [[ "$ref_kind" == branch ]]; then
        # Protect ignored files while switching. Pull only fast-forward updates;
        # disable configured rebasing and autostashing so conflicts stop setup.
        if git -C "$repo_root" show-ref --verify --quiet "$branch_ref"; then
            run git -C "$repo_root" switch --no-overwrite-ignore --no-guess "$repo_ref"
        else
            run git -C "$repo_root" switch --no-overwrite-ignore --no-track -c "$repo_ref" "$selected_ref"
        fi
        run git -C "$repo_root" pull --ff-only --no-rebase --no-autostash --no-tags origin "$branch_ref"
    else
        run git -C "$repo_root" switch --no-overwrite-ignore --detach "$selected_ref"
    fi
else
    # An empty directory is a normal first-run destination. Dotfiles count as
    # existing contents too; never delete a nonempty folder to make room.
    shopt -s nullglob dotglob
    contents=("$repo_root"/*)
    (( ${#contents[@]} == 0 )) || fail "The installation directory contains unrelated files: $repo_root"
    printf 'Cloning Luna...\n'
    staged_checkout=$(mktemp -d "${repo_root%/*}/.luna-clone.XXXXXX")
    run retry git clone --branch "$repo_ref" --single-branch -- "$repo_url" "$staged_checkout"
    # Rename the completed checkout over the empty destination. A nonempty folder
    # created meanwhile makes the rename fail instead of merging or deleting it.
    mv -T -- "$staged_checkout" "$repo_root"
    staged_checkout=
fi
# Hooks and the CLI use the resolved checkout; user-supplied flags stay unchanged.
export LUNA_ROOT="$repo_root"

# 7. Build the API and CLI using the committed lockfile. Stage beside the destination
# so a failed install, build, or copy keeps the old CLI.
printf 'Building Luna CLI...\n'
# Keep directory changes inside a subshell so relative flags forwarded later still
# refer to the directory from which the user started the installer.
(
    cd -- "$repo_root"
    run bun install --frozen-lockfile
    run bun run --cwd packages/luna-api build
    run bun run --cwd src/luna-cli build
)
staged_cli=$(mktemp "$bin_dir/.luna.XXXXXX")
run install -m755 -- "$repo_root/target/luna-bun" "$staged_cli"
# Renaming on the destination filesystem publishes the completed binary at once.
mv -fT -- "$staged_cli" "$bin_dir/luna"
staged_cli=

# 8. Give the user five seconds to stop before the CLI configures the rest.
# Signal handlers print a shell-safe recovery command with the same caller flags.
cancel_handoff() {
    printf '\nSetup cancelled. Other settings are not configured. To finish, run:\n'
    printf '  %q self install' "$bin_dir/luna"
    # With no arguments, printf would otherwise emit an unwanted empty argument.
    if (( ${#cli_args[@]} > 0 )); then
        printf ' %q' "${cli_args[@]}"
    fi
    printf '\n'
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
# The manual-resume message applies only to the pause, before CLI setup begins.
trap 'exit 130' INT
trap 'exit 143' TERM
printf 'Configuring Luna...\n'
"$bin_dir/luna" self install "${cli_args[@]}"
