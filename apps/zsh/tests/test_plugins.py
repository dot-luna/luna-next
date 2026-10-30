"""Exercise packaged Zsh plugin loading without installing packages on the host."""

from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


REPO = Path(__file__).resolve().parents[3]
ZSH = shutil.which("zsh")


@unittest.skipUnless(ZSH, "Zsh is required")
class ZshPluginTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="luna plugins '")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.share = self.root / "share/zsh"
        self.config = self.root / "config"
        self.config.mkdir()

        # Redirect the fixed package prefix in temporary copies, not production settings.
        for name in ("completion.zsh", "plugins.zsh"):
            source = (REPO / "apps/zsh/config/zsh" / name).read_text()
            (self.config / name).write_text(source.replace("/usr/share/zsh", str(self.share)))
        self.env = {
            "HOME": str(self.home),
            "ZDOTDIR": str(self.home),
            "PATH": str(self.bin),
            "TERM": "xterm",
            "LUNA_TEST_CONFIG": str(self.config),
            "LUNA_TEST_SHARE": str(self.share),
        }

    def run_zsh(self, code, interactive=True):
        args = [ZSH, "-d", "-f"]
        if interactive:
            args.append("-i")
        result = subprocess.run(
            [*args, "-c", code], env=self.env, cwd=self.root,
            input="", capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stderr, "")
        return result.stdout

    def add_command(self, name, code="exit 0\n"):
        command = self.bin / name
        command.write_text("#!/bin/sh\n" + code)
        command.chmod(0o755)

    def add_plugin(self, name):
        script = self.share / "plugins" / name / (
            "fzf-tab.plugin.zsh" if name == "fzf-tab" else f"{name}.zsh"
        )
        script.parent.mkdir(parents=True, exist_ok=True)
        guards = {
            "fzf-tab": "fzf-tab-complete",
            "zsh-autosuggestions": "_zsh_autosuggest_start",
            "zsh-syntax-highlighting": "_zsh_highlight",
        }
        script.write_text(
            "typeset -ga LUNA_TEST_LOADS\n"
            f"LUNA_TEST_LOADS+=({name})\n"
            f"{guards[name]}() {{ return 0; }}\n"
        )
        if name == "fzf-tab":
            with script.open("a") as stream:
                stream.write("zle -N fzf-tab-complete\nbindkey '^I' fzf-tab-complete\n")
        if name == "zsh-autosuggestions":
            with script.open("a") as stream:
                stream.write("_zsh_autosuggest_start() { (( LUNA_TEST_SUGGESTION_STARTS += 1 )); }\n")
        return script

    def add_all_plugins(self):
        for name in ("fzf-tab", "zsh-autosuggestions", "zsh-syntax-highlighting"):
            self.add_plugin(name)
        self.add_command("fzf")

    def test_completion_package_is_discovered_before_compinit(self):
        completions = self.share / "site-functions"
        completions.mkdir(parents=True)
        (completions / "_luna_package").write_text("#compdef luna-package\nreturn 0\n")
        output = self.run_zsh("""
source "$LUNA_TEST_CONFIG/completion.zsh"
source "$LUNA_TEST_CONFIG/completion.zsh"
print -r -- "${_comps[luna-package]}"
print -rl -- "${fpath[@]}"
""")
        lines = output.splitlines()
        self.assertEqual(lines[0], "_luna_package")
        self.assertEqual(lines[1:].count(str(completions)), 1)

    def test_completion_styles_and_later_personal_overrides(self):
        self.env["LS_COLORS"] = "di=34:ln=36"
        output = self.run_zsh("""
source "$LUNA_TEST_CONFIG/completion.zsh"
zstyle -s ':completion:*' matcher-list value; print -r -- "$value"
zstyle -a ':completion:*' list-colors colors; print -rl -- "${colors[@]}"
zstyle ':completion:*' matcher-list personal
source "$LUNA_TEST_CONFIG/completion.zsh"
zstyle -s ':completion:*' matcher-list value; print -r -- "$value"
""")
        self.assertEqual(output.splitlines(), ["m:{a-zA-Z}={A-Za-z}", "di=34", "ln=36", "personal"])

    def test_plugins_wait_for_personal_compinit_and_load_once_in_order(self):
        self.add_all_plugins()
        output = self.run_zsh("""
source "$LUNA_TEST_CONFIG/completion.zsh"
() { source "$LUNA_TEST_CONFIG/plugins.zsh"; }
source "$LUNA_TEST_CONFIG/plugins.zsh"
print -r -- "${#LUNA_TEST_LOADS}:${#precmd_functions}"
# The user's existing startup file initializes completions again below Luna.
autoload -Uz compinit
compinit -i -D
for hook in "${precmd_functions[@]}"; do "$hook"; done
print -rl -- "${LUNA_TEST_LOADS[@]}"
print -r -- "$LUNA_TEST_SUGGESTION_STARTS"
bindkey '^I'
source "$LUNA_TEST_CONFIG/plugins.zsh"
print -r -- "${#LUNA_TEST_LOADS}:${#precmd_functions}:$+functions[_luna_zsh_load_plugins]"
""")
        self.assertEqual(output.splitlines(), [
            "0:1", "fzf-tab", "zsh-autosuggestions", "zsh-syntax-highlighting", "1",
            '"^I" fzf-tab-complete', "3:0:0",
        ])

    def test_missing_plugins_do_not_create_a_hook(self):
        output = self.run_zsh("""
source "$LUNA_TEST_CONFIG/completion.zsh"
source "$LUNA_TEST_CONFIG/plugins.zsh"
print -r -- "${#precmd_functions}:$+functions[_luna_zsh_load_plugins]"
""")
        self.assertEqual(output.strip(), "0:0")

    def test_missing_fzf_skips_its_plugin_without_affecting_other_plugins(self):
        self.add_all_plugins()
        (self.bin / "fzf").unlink()
        output = self.run_zsh("""
source "$LUNA_TEST_CONFIG/completion.zsh"
source "$LUNA_TEST_CONFIG/plugins.zsh"
for hook in "${precmd_functions[@]}"; do "$hook"; done
print -rl -- "${LUNA_TEST_LOADS[@]}"
""")
        self.assertEqual(output.splitlines(), ["zsh-autosuggestions", "zsh-syntax-highlighting"])

    def test_existing_plugins_are_preserved_and_never_resourced(self):
        self.add_all_plugins()
        output = self.run_zsh("""
source "$LUNA_TEST_CONFIG/completion.zsh"
fzf-tab-complete() { print -r -- personal-fzf; }
_zsh_autosuggest_start() { print -r -- personal-suggestions; }
_zsh_highlight() { print -r -- personal-highlighting; }
source "$LUNA_TEST_CONFIG/plugins.zsh"
fzf-tab-complete
_zsh_autosuggest_start
_zsh_highlight
print -r -- "${#LUNA_TEST_LOADS}:${#precmd_functions}"
""")
        self.assertEqual(output.splitlines(), ["personal-fzf", "personal-suggestions",
                                              "personal-highlighting", "0:0"])

    def test_plugin_loaded_later_by_personal_config_is_not_loaded_again(self):
        self.add_all_plugins()
        output = self.run_zsh("""
source "$LUNA_TEST_CONFIG/completion.zsh"
source "$LUNA_TEST_CONFIG/plugins.zsh"
_zsh_autosuggest_start() { return 0; }
for hook in "${precmd_functions[@]}"; do "$hook"; done
print -rl -- "${LUNA_TEST_LOADS[@]}"
""")
        self.assertEqual(output.splitlines(), ["fzf-tab", "zsh-syntax-highlighting"])

    def test_directory_preview_quotes_paths_and_personal_style_wins(self):
        self.add_all_plugins()
        self.add_command("eza", "printf '<%s>\\n' \"$@\"\n")
        output = self.run_zsh("""
source "$LUNA_TEST_CONFIG/completion.zsh"
source "$LUNA_TEST_CONFIG/plugins.zsh"
zstyle -s ':fzf-tab:complete:cd:*' fzf-preview preview
zstyle -s ':fzf-tab:complete:z:*' fzf-preview z_preview
[[ "$z_preview" == "$preview" ]] || exit 1
realpath='a directory; printf injected'
eval "$preview"
zstyle ':fzf-tab:complete:cd:*' fzf-preview personal
for hook in "${precmd_functions[@]}"; do "$hook"; done
zstyle -s ':fzf-tab:complete:cd:*' fzf-preview preview
print -r -- "$preview"
""")
        self.assertEqual(output.splitlines(), ["<--color=always>", "<--group-directories-first>",
                                              "<-->", "<a directory; printf injected>", "personal"])

    def test_noninteractive_shell_does_not_initialize_completion_or_plugins(self):
        self.add_all_plugins()
        output = self.run_zsh("""
source "$LUNA_TEST_CONFIG/completion.zsh"
source "$LUNA_TEST_CONFIG/plugins.zsh"
print -r -- "$+functions[compdef]:${#precmd_functions}:${#LUNA_TEST_LOADS}"
""", interactive=False)
        self.assertEqual(output.strip(), "0:0:0")


if __name__ == "__main__":
    unittest.main()
