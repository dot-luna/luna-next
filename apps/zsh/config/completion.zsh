# Initialize general shell completion, including when mise is unavailable.
() {
    [[ -o interactive ]] || return 0

    # Arch's zsh-completions package puts its definitions here, before compinit scans.
    local luna_completion_dir="/usr/share/zsh/site-functions"
    if [[ -d "$luna_completion_dir" ]] && (( ${fpath[(Ie)$luna_completion_dir]} == 0 )); then
        fpath+=("$luna_completion_dir")
    fi
    (( $+functions[compdef] )) && return 0

    # Keep completion useful without the optional fzf-tab plugin.
    zstyle ':completion:*' matcher-list 'm:{a-zA-Z}={A-Za-z}'
    zstyle ':completion:*' menu select
    zstyle ':completion:*:descriptions' format '[%d]'
    if [[ -n "${LS_COLORS:-}" ]]; then
        zstyle ':completion:*' list-colors "${(s.:.)LS_COLORS}"
    fi

    # Skip insecure directories without prompts or a startup-file cache.
    autoload -Uz compinit
    compinit -i -D || return 0
}
