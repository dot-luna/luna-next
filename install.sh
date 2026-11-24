#!/usr/bin/env bash
# Bootstrap only the Luna CLI on Arch Linux.
# Run as a normal user with sudo, or as root in the official Arch live ISO.
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
# Binary: $HOME/.local/bin/luna, or /usr/local/bin/luna in the live ISO.
# --install-dir changes only the source location.
#
# Bootstrap steps:
#   1. Resolve paths and create missing checkout/binary directories.
#   2. Upgrade Arch and install only ca-certificates, git, and mise.
#   3. Install mise's global bun@latest and add it to this script's PATH.
#   4. Clone the selected Git ref, or safely update an existing Luna checkout.
#   5. Run bun install --frozen-lockfile at the checkout root, then
#      bun run --cwd src/luna-cli build --no-install to produce target/luna.
#   6. Publish that binary as ~/.local/bin/luna with executable permissions.
#   7. Print the next command; Arch and desktop setup are started manually.
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
# copied successfully. Staged files are removed on exit; private diagnostic logs remain under the state directory;
# the source checkout and its CLI build artifacts remain for later operations.
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
live_iso=false
if (( EUID == 0 )); then
    [[ -d /run/archiso ]] || fail 'Run as your normal user, without sudo, outside the Arch live ISO.'
    live_iso=true
fi
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
privilege=(sudo)
required_tools=(pacman sudo)
if $live_iso; then
    bin_dir=$(prepare_directory /usr/local/bin)
    privilege=()
    required_tools=(pacman)
fi
for tool in "${required_tools[@]}"; do
    command -v "$tool" >/dev/null 2>&1 || fail "$tool is required; prepare an Arch Linux user with sudo access first."
done

# Keep diagnostics outside temporary staging, including early bootstrap failures.
state_root=${LUNA_STATE_HOME_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/luna}
[[ "$state_root" == /* && "$state_root" != / && "$state_root" != *[[:cntrl:]]* ]] || fail 'Invalid state directory.'
log_root=$(prepare_directory "$state_root/install-logs")
log_dir=$(umask 077; mktemp -d "$log_root/bootstrap.XXXXXX")
bootstrap_log="$log_dir/bootstrap.log"
(umask 077; : >"$bootstrap_log")
printf 'Bootstrap logs: %s\n' "$bootstrap_log"

# 2. Keep successful tool output quiet, but show the failed command's diagnostics.
if ! temporary=$(mktemp -d 2>/dev/null); then
    temporary=$(mktemp -d /tmp/luna-install.XXXXXX)
fi
staged_cli=
staged_checkout=
# Remove only this run's staging files; retained diagnostics survive failure.
cleanup() {
    local exit_status=$?
    if [[ -n "${bootstrap_log:-}" ]]; then
        printf 'Exit status: %s\n' "$exit_status" >>"$bootstrap_log"
        if (( exit_status != 0 )); then printf 'install: Logs: %s\n' "$bootstrap_log" >&2; fi
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
# on failure.
run() {
    local status
    printf '+ %q ' "$@" >>"$bootstrap_log"
    printf '\n' >>"$bootstrap_log"
    if "$@" >"$temporary/output" 2>&1; then
        cat -- "$temporary/output" >>"$bootstrap_log"
        return 0
    else
        status=$?
        cat -- "$temporary/output" >>"$bootstrap_log"
        cat -- "$temporary/output" >&2
        printf 'install: Logs: %s\n' "$bootstrap_log" >&2
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
# only CLI bootstrap tools. App packages and native build tools belong to CLI setup.
# Authenticate before hiding package output; sudo can prompt through the terminal.
if ! $live_iso; then sudo -v; fi
printf 'Updating system packages...\n'
run "${privilege[@]}" pacman -Syu --needed --noconfirm -- ca-certificates git mise

# 4. Use mise's global Bun tool so both the build and later CLI hooks can use it.
# Resolve outside the checkout so project mise tasks do not require a trust prompt.
printf 'Installing Bun...\n'
run retry mise --cd "$HOME" use --global --yes bun@latest
bun_path=$(mise --cd "$HOME" which bun)
# Make this Bun installation available immediately, without editing shell startup files.
export PATH="${bun_path%/*}:$bin_dir:$PATH"

# 5. Resolve latest from Git's advertised default branch, then keep the selected
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
# Hooks and the CLI use the resolved checkout; user-supplied flag values stay unchanged.
export LUNA_ROOT="$repo_root"

# 6. Build the CLI using the committed lockfile. Bun resolves the API's source
# directly, without a separate API build. Stage beside the destination so a failed
# dependency install, build, or copy keeps the old CLI.
printf 'Building Luna CLI...\n'
# Keep the build working directory local to this subshell.
(
    cd -- "$repo_root"
    run bun install --frozen-lockfile
    run bun run --cwd src/luna-cli build --no-install
)
staged_cli=$(mktemp "$bin_dir/.luna.XXXXXX")
run install -m755 -- "$repo_root/target/luna" "$staged_cli"
# Renaming on the destination filesystem publishes the completed binary at once.
mv -fT -- "$staged_cli" "$bin_dir/luna"
staged_cli=

# Installing the CLI never starts disk operations or desktop setup.
printf 'Installed Luna CLI: %s\n' "$bin_dir/luna"
if $live_iso; then
    printf 'To install Arch, run:\n  bash %q\n' "$repo_root/arch-install.sh"
else
    printf 'To configure Luna, run:\n  %q self install --install-dir %q --ref %q\n' "$bin_dir/luna" "$repo_root" "$repo_ref"
fi
