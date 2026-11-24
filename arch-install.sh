#!/usr/bin/env bash
# Run from a Luna checkout in the official Arch live ISO, after install.sh.
set -euo pipefail
repository=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
exec bash "$repository/src/arch-install/src/install.sh" "$@"
