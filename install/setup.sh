#!/usr/bin/env bash
set -euo pipefail

installer_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
"$installer_dir/install.sh"

export LUNA_NEXT_ROOT="$HOME/.local/src/luna-next"
export PATH="$HOME/.local/bin:$PATH"
exec "$HOME/.local/bin/luna" setup --repo "$LUNA_NEXT_ROOT" "$@"
