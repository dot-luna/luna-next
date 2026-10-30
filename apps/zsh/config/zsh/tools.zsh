# Optional tool integrations; each block keeps its temporary variables local.

# Activate mise for the current shell and load the completion saved during setup.
() {
    [[ -o interactive ]] || return 0
    (( $+commands[mise] )) || return 0

    local luna_zsh_dir="${${(%):-%x}:A:h}"
    local luna_mise_activation

    # Generate activation now: saving it at setup time would freeze that process's PATH.
    # An existing hook also prevents duplicate activation when .zshrc is sourced again.
    if (( ! $+functions[_mise_hook] )); then
        if luna_mise_activation="$(command mise activate zsh)"; then
            eval "$luna_mise_activation"
        fi
    fi

    if (( $+functions[compdef] )) && [[ -r "$luna_zsh_dir/generated/mise-completion.zsh" ]]; then
        local luna_mise_completion="${luna_previous_mise_completion-${_comps[mise]-}}"

        # Prefer the generated file to auto-discovered completions, keeping personal ones.
        # The enclosing zshrc remembers the registration before shared completion setup.
        if [[ -z "$luna_mise_completion" ]]; then
            source "$luna_zsh_dir/generated/mise-completion.zsh"
        fi
    fi

    return 0
}

# Keep the original ls and cat commands available alongside convenient eza shortcuts.
() {
    [[ -o interactive ]] || return 0
    (( $+commands[eza] )) || return 0

    # Existing personal aliases and functions take precedence over Luna's defaults.
    if (( ! $+aliases[ll] && ! $+functions[ll] )); then
        alias ll='eza --long --git --group-directories-first --color=auto --icons=auto'
    fi
    if (( ! $+aliases[la] && ! $+functions[la] )); then
        alias la='eza --long --all --git --group-directories-first --color=auto --icons=auto'
    fi
    if (( ! $+aliases[lt] && ! $+functions[lt] )); then
        alias lt='eza --tree --level=2 --group-directories-first --color=auto --icons=auto'
    fi
}

# Alias directory commands to zoxide's shell functions, which can change this shell.
() {
    [[ -o interactive ]] || return 0
    (( $+commands[zoxide] )) || return 0

    local luna_zoxide_init

    # Only evaluate complete, successful output; upstream also deduplicates its hooks.
    if (( ! $+functions[__zoxide_z] || ! $+functions[z] || ! $+functions[zi] )); then
        if luna_zoxide_init="$(command zoxide init zsh)"; then
            eval "$luna_zoxide_init"
        fi
    fi

    if (( $+functions[__zoxide_z] && $+functions[z] && $+functions[zi] )); then
        alias cd='z'
        alias cdi='zi'
    fi

    return 0
}

# Load fzf's history, file, and directory widgets before plugins wrap completion.
() {
    [[ -o interactive ]] || return 0
    (( $+commands[fzf] )) || return 0

    # Test parameter presence: an explicitly empty command disables its key binding.
    if (( $+commands[fd] )); then
        if (( ! ${+FZF_DEFAULT_COMMAND} )); then
            export FZF_DEFAULT_COMMAND='command fd --type f --hidden --exclude .git'
        fi
        if (( ! ${+FZF_CTRL_T_COMMAND} )); then
            export FZF_CTRL_T_COMMAND='command fd --type f --hidden --exclude .git'
        fi
        if (( ! ${+FZF_ALT_C_COMMAND} )); then
            export FZF_ALT_C_COMMAND='command fd --type d --hidden --exclude .git'
        fi
    fi

    local luna_fzf_directory_preview
    local luna_fzf_preview
    local luna_fzf_init

    if (( $+commands[eza] )); then
        luna_fzf_directory_preview='command eza --oneline --all --color=always --icons=always --group-directories-first -- {}'
    elif (( $+commands[ls] )); then
        luna_fzf_directory_preview='command ls -A --color=always -- {}'
    else
        luna_fzf_directory_preview='printf "%s\n" {}'
    fi

    # fzf shell-quotes each {} placeholder. Keep it unquoted here and terminate options
    # with -- so spaces, quotes, and leading dashes in selected paths remain literal.
    if (( $+commands[bat] && ! ${+FZF_CTRL_T_OPTS} )); then
        luna_fzf_preview="if [ -d {} ]; then $luna_fzf_directory_preview; elif [ -f {} ]; then command bat --color=always --style=numbers --paging=never --line-range=:300 -- {}; fi"
        export FZF_CTRL_T_OPTS="--preview '$luna_fzf_preview'"
    fi
    if (( ! ${+FZF_ALT_C_OPTS} )); then
        export FZF_ALT_C_OPTS="--preview '$luna_fzf_directory_preview'"
    fi

    # A supplied or previously loaded integration keeps its widget customizations.
    (( $+functions[fzf-history-widget] )) && return 0
    if luna_fzf_init="$(command fzf --zsh)"; then
        eval "$luna_fzf_init"
    fi

    return 0
}

# Select the configured Starship export before initializing the interactive prompt.
() {
    export STARSHIP_CONFIG="${STARSHIP_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/starship.toml}"

    [[ -o interactive ]] || return 0
    (( $+commands[starship] )) || return 0
    (( $+functions[prompt_starship_precmd] )) && return 0

    local luna_starship_init

    if luna_starship_init="$(command starship init zsh)"; then
        eval "$luna_starship_init"
    fi

    return 0
}
