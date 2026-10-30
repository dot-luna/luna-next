#!/bin/sh
set -eu

: "${LUNA_CONFIG_OUTPUT:?Missing configuration staging directory}"

# Only fresh, complete output enters the exported tree; activation stays in Zsh.
completion="$LUNA_CONFIG_OUTPUT/zsh/generated/mise-completion.zsh"
if command -v mise >/dev/null 2>&1; then
    mkdir -p "$LUNA_CONFIG_OUTPUT/zsh/generated"
    if mise --cd "${HOME:?Missing home directory}" completion zsh > "$completion.tmp"; then
        mv "$completion.tmp" "$completion"
    else
        rm -f "$completion.tmp"
        printf '%s\n' 'Mise completion generation failed; skipping Zsh completion.' >&2
    fi
else
    printf '%s\n' 'Mise is unavailable; skipping Zsh completion generation.' >&2
fi
