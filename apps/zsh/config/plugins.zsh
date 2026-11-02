# Load packaged plugins after the rest of .zshrc has finished setting up widgets.
() {
    [[ -o interactive ]] || return 0
    (( $+functions[_luna_zsh_load_plugins] )) && return 0

    local -i luna_fzf_tab=0 luna_autosuggestions=0 luna_highlighting=0
    if (( $+commands[fzf] && $+functions[compdef] && ! $+functions[fzf-tab-complete] )) \
        && [[ -r "/usr/share/zsh/plugins/fzf-tab/fzf-tab.plugin.zsh" ]]; then
        luna_fzf_tab=1
    fi
    if (( ! $+functions[_zsh_autosuggest_start] )) \
        && [[ -r "/usr/share/zsh/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh" ]]; then
        luna_autosuggestions=1
    fi
    if (( ! $+functions[_zsh_highlight] )) \
        && [[ -r "/usr/share/zsh/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh" ]]; then
        luna_highlighting=1
    fi
    (( luna_fzf_tab || luna_autosuggestions || luna_highlighting )) || return 0

    # fzf-tab owns the selection menu once its plugin loads.
    if (( luna_fzf_tab )); then
        zstyle ':completion:*' menu no
        if (( $+commands[eza] )); then
            zstyle ':fzf-tab:complete:(cd|z):*' fzf-preview \
                'eza --color=always --group-directories-first -- "$realpath"'
        fi
    fi

    # The first prompt runs this after all startup widgets exist, with highlighting
    # last as required by ZLE.
    _luna_zsh_load_plugins() {
        add-zsh-hook -d precmd _luna_zsh_load_plugins

        if (( $+commands[fzf] && $+functions[compdef] && ! $+functions[fzf-tab-complete] )) \
            && [[ -r "/usr/share/zsh/plugins/fzf-tab/fzf-tab.plugin.zsh" ]]; then
            source "/usr/share/zsh/plugins/fzf-tab/fzf-tab.plugin.zsh"
        fi
        if (( ! $+functions[_zsh_autosuggest_start] )) \
            && [[ -r "/usr/share/zsh/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh" ]]; then
            source "/usr/share/zsh/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh"

            # Its newly registered precmd hook may only run on the following prompt.
            (( $+functions[_zsh_autosuggest_start] )) && _zsh_autosuggest_start
        fi
        if (( ! $+functions[_zsh_highlight] )) \
            && [[ -r "/usr/share/zsh/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh" ]]; then
            source "/usr/share/zsh/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh"
        fi

        unfunction _luna_zsh_load_plugins
        return 0
    }

    autoload -Uz add-zsh-hook
    add-zsh-hook precmd _luna_zsh_load_plugins
}
