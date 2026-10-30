#!/usr/bin/env bash
set -euo pipefail

fail() {
    printf 'setup: %s\n' "$*" >&2
    exit 1
}

installer_arguments=()
setup_arguments=()
while (( $# )); do
    case "$1" in
        --ref)
            (( $# >= 2 )) || fail '--ref requires a branch or tag name.'
            [[ -n "$2" && "$2" != -* ]] || fail '--ref requires a branch or tag name.'
            (( ${#installer_arguments[@]} == 0 )) || fail '--ref may only be supplied once.'
            installer_arguments=(--ref "$2")
            shift 2
            ;;
        *)
            setup_arguments+=("$1")
            shift
            ;;
    esac
done

command -v curl >/dev/null 2>&1 || {
    printf 'setup: curl is required.\n' >&2
    exit 1
}
curl -fsSL --proto '=https' --tlsv1.2 \
    https://raw.githubusercontent.com/dot-luna/luna-next/master/install/install.sh \
    | bash -s -- "${installer_arguments[@]}"

export LUNA_NEXT_ROOT="$HOME/.local/src/luna-next"
export PATH="$HOME/.local/bin:$PATH"
exec "$HOME/.local/bin/luna" setup --repo "$LUNA_NEXT_ROOT" "${setup_arguments[@]}"
