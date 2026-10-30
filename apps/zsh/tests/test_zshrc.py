"""Load Luna's modular Zsh configuration without using personal shell startup files."""

from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


REPO = Path(__file__).resolve().parents[3]
ZSH = shutil.which("zsh")


@unittest.skipUnless(ZSH, "Zsh is required")
class ZshrcTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="luna zsh '")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.config = self.root / "installed config/zsh"
        shutil.copytree(REPO / "apps/zsh/config/zsh", self.config)
        # Host plugin packages must not add hooks to isolated startup tests.
        plugins = self.config / "plugins.zsh"
        plugins.write_text(plugins.read_text().replace("/usr/share/zsh", str(self.root / "share/zsh")))
        self.generated = self.config / "generated"
        self.generated.mkdir(exist_ok=True)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.mise = self.bin / "mise"
        self.mise.write_text("""#!/bin/sh
printf '%s\\n' "$*" >> "$LUNA_TEST_MISE_LOG"
[ "$*" = 'activate zsh' ] || exit 2
if [ "${LUNA_TEST_MISE_FAIL:-}" = 1 ]; then
    printf '%s\\n' 'export LUNA_TEST_FAILED_ACTIVATION=1'
    exit 1
fi
printf '%s\\n' '(( LUNA_TEST_ACTIVATIONS += 1 ))' \\
    '_mise_hook() { return 0; }' \\
    'typeset -ga precmd_functions' \\
    'precmd_functions+=(_mise_hook)'
""")
        self.mise.chmod(0o755)
        self.log = self.root / "mise.log"
        self.env = {
            "HOME": str(self.home),
            "PATH": str(self.bin),
            "ZDOTDIR": str(self.home),
            "TERM": "xterm",
            "LUNA_TEST_CONFIG": str(self.config),
            "LUNA_TEST_MISE_LOG": str(self.log),
        }

    def add_starship(self):
        starship = self.bin / "starship"
        starship.write_text("""#!/bin/sh
[ "$*" = 'init zsh' ] || exit 2
if [ "${LUNA_TEST_STARSHIP_FAIL:-}" = 1 ]; then
    printf '%s\\n' 'export LUNA_TEST_FAILED_STARSHIP=1'
    exit 1
fi
printf '%s\\n' '(( LUNA_TEST_PROMPTS += 1 ))' \\
    'prompt_starship_precmd() { return 0; }' \\
    'typeset -ga precmd_functions' \\
    'precmd_functions+=(prompt_starship_precmd)'
""")
        starship.chmod(0o755)

    def run_zsh(self, command, interactive=False):
        args = [ZSH, "-d", "-f"]
        if interactive:
            args.append("-i")
        result = subprocess.run(
            [*args, "-c", command], env=self.env, cwd=self.root,
            input="", capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stderr, "")
        return result.stdout

    def add_generated_completion(self):
        # Registration requires compinit, just like the actual generated mise completion.
        (self.generated / "mise-completion.zsh").write_text("""
(( LUNA_TEST_COMPLETIONS += 1 ))
_luna_test_mise_completion() { return 0; }
compdef _luna_test_mise_completion mise
""")

    def test_loads_modules_and_exports_repository_root_without_old_luna_environment(self):
        installed = str(self.home / ".local/src/luna-next")
        custom = str(self.root / "development ' checkout")
        for override, expected in ((None, installed), ("", installed), (custom, custom)):
            with self.subTest(override=override):
                if override is None:
                    self.env.pop("LUNA_NEXT_ROOT", None)
                else:
                    self.env["LUNA_NEXT_ROOT"] = override
                output = self.run_zsh("""
source "$LUNA_TEST_CONFIG/zshrc"
/usr/bin/env
""", interactive=True)
                exported = dict(line.split("=", 1) for line in output.splitlines())
                self.assertNotIn("LUNA_INSTALL_DIR", exported)
                self.assertNotIn("LUNA_CONFIG_DIR", exported)
                self.assertEqual(exported["LUNA_NEXT_ROOT"], expected)
                self.assertEqual(exported["PATH"], f"{self.home}/.local/bin:{self.bin}")

    def test_paths_are_not_duplicated_and_existing_order_is_preserved(self):
        original = f"{self.bin}:{self.home}/.local/bin:/another directory"
        self.env["PATH"] = original
        output = self.run_zsh("""
source "$LUNA_TEST_CONFIG/zshrc"
source "$LUNA_TEST_CONFIG/zshrc"
print -r -- "$PATH"
""")
        self.assertEqual(output.strip(), original)

    def test_repeated_source_has_no_temporary_variables_or_option_changes(self):
        output = self.run_zsh("""
before_options=$(setopt)
source "$LUNA_TEST_CONFIG/zshrc"
source "$LUNA_TEST_CONFIG/zshrc"
[[ "$(setopt)" == "$before_options" ]] || exit 1
(( ! ${+luna_zsh_dir} )) || exit 1
print -r -- "$PATH"
""")
        self.assertEqual(output.strip(), f"{self.home}/.local/bin:{self.bin}")

    def test_noninteractive_source_skips_mise_and_completion_setup(self):
        self.add_generated_completion()
        self.add_starship()
        output = self.run_zsh("""
HISTSIZE=7
SAVEHIST=3
source "$LUNA_TEST_CONFIG/zshrc"
print -r -- "${LUNA_TEST_ACTIVATIONS:-0}:${LUNA_TEST_COMPLETIONS:-0}:$+functions[compdef]"
print -r -- "${LUNA_TEST_PROMPTS:-0}:${HISTFILE-unset}:$HISTSIZE:$SAVEHIST"
""")
        self.assertEqual(output.splitlines(), ["0:0:0", "0:unset:7:3"])
        self.assertFalse(self.log.exists())

    def test_interactive_history_and_emacs_bindings(self):
        output = self.run_zsh("""
bindkey -v
source "$LUNA_TEST_CONFIG/zshrc"
print -r -- "$HISTFILE"
print -r -- "$HISTSIZE:$SAVEHIST"
bindkey '^A'
""", interactive=True)
        self.assertEqual(output.splitlines(), [str(self.home / ".histfile"), "32768:32768",
                                              '"^A" beginning-of-line'])

    def test_saved_history_retains_old_commands_and_omits_spaces_and_consecutive_duplicates(self):
        # Interactive stdin exercises Zsh's real history reader and exit-time writer.
        (self.home / ".zshrc").write_text(
            'source "$LUNA_TEST_CONFIG/zshrc"\nPROMPT=""\nunsetopt PROMPT_SP\n'
        )
        history = self.home / ".histfile"
        previous = [f"print -r -- saved-{number}" for number in range(1500)]
        history.write_text("\n".join(previous) + "\n")
        commands = [
            "print -r -- first",
            "print -r -- first",
            " print -r -- hidden",
            "print -r -- second",
            "print -r -- first",
            "exit",
        ]
        for session in (commands, ["print -r -- later-session", "exit"]):
            result = subprocess.run(
                [ZSH, "-d", "-i"], env=self.env, cwd=self.root,
                input="\n".join(session) + "\n", capture_output=True, text=True, timeout=10,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(result.stderr, "")

        self.assertEqual(history.read_text().splitlines(), [
            *previous, "print -r -- first", "print -r -- second", "print -r -- first",
            "exit", "print -r -- later-session", "exit",
        ])

    def assert_history_navigation(self):
        (self.home / ".histfile").write_text(
            "git status\nprint unrelated\ngit log\nprint newest\n"
        )
        capture = self.root / "editor buffers"
        self.env.update(LUNA_TEST_ZSH=ZSH, LUNA_TEST_CAPTURE=str(capture))
        # Record the editor buffer without accepting/executing commands. Reset the
        # history position between cases so one search cannot influence the next.
        (self.home / ".zshrc").write_text(r'''
source "$LUNA_TEST_CONFIG/zshrc"
PROMPT='LUNA_TEST_READY>'
RPROMPT=''
_capture_buffer() { print -rn -- "$BUFFER"$'\0'"$CURSOR"$'\0' >> "$LUNA_TEST_CAPTURE"; }
_reset_buffer() { zle .end-of-history; zle .kill-buffer; }
_multiline_buffer() { BUFFER=$'first line\nsecond line'; CURSOR=3; }
zle -N _capture_buffer
zle -N _reset_buffer
zle -N _multiline_buffer
bindkey '^O' _capture_buffer
bindkey '^K' _reset_buffer
bindkey '^Y' _multiline_buffer
zshexit() { print -r -- LUNA_TEST_FINISHED; }
''')
        cases = []
        expected = []
        for up, down in (("\x1b[A", "\x1b[B"), ("\x1bOA", "\x1bOB")):
            cases.extend([
                "git" + up,
                "git" + up * 2,
                "git" + up * 2 + down,
                "git" + up + down,
                up,
                "\x19" + down,
                "\x19" + down + up,
            ])
            expected.extend([
                ("git log", 7), ("git status", 10), ("git log", 7), ("git", 3),
                ("print newest", 12), ("first line\nsecond line", 14),
                ("first line\nsecond line", 3),
            ])
        self.env["LUNA_TEST_KEYS"] = "".join("\x0b" + keys + "\x0f" for keys in cases)
        self.env["LUNA_TEST_KEYS"] += "\x0bexit\n"
        self.run_zsh('''
zmodload zsh/zpty
zpty terminal "$LUNA_TEST_ZSH" -d -i
zpty -r terminal output '*LUNA_TEST_READY>*'
zpty -w -n terminal "$LUNA_TEST_KEYS"
zpty -r terminal output '*LUNA_TEST_FINISHED*'
zpty -d terminal
''')
        fields = capture.read_text().split("\0")[:-1]
        self.assertEqual(
            [(buffer, int(cursor)) for buffer, cursor in zip(fields[::2], fields[1::2])],
            expected,
        )

    def test_history_arrows_search_prefix_and_preserve_multiline_edits(self):
        self.assert_history_navigation()

    def test_history_arrows_with_packaged_suggestions_and_highlighting(self):
        packages = Path("/usr/share/zsh/plugins")
        plugins = ("zsh-autosuggestions", "zsh-syntax-highlighting")
        if not all((packages / plugin / f"{plugin}.zsh").is_file() for plugin in plugins):
            self.skipTest("Packaged Zsh suggestions and highlighting are required")
        isolated = self.root / "share/zsh/plugins"
        isolated.mkdir(parents=True)
        for plugin in plugins:
            (isolated / plugin).symlink_to(packages / plugin, target_is_directory=True)
        self.assert_history_navigation()

    def test_existing_history_file_and_personal_overrides_are_preserved(self):
        self.env["HISTFILE"] = str(self.root / "personal history")
        output = self.run_zsh("""
source "$LUNA_TEST_CONFIG/zshrc"
print -r -- "$HISTFILE"
HISTSIZE=9000
SAVEHIST=8000
bindkey -v
print -r -- "$HISTSIZE:$SAVEHIST"
bindkey -lL main
""", interactive=True)
        self.assertEqual(output.splitlines(), [self.env["HISTFILE"], "9000:8000",
                                              "bindkey -A viins main"])

    def test_development_defaults_export_without_adding_missing_paths(self):
        output = self.run_zsh("""
source "$LUNA_TEST_CONFIG/zshrc"
/usr/bin/env
""")
        exported = dict(line.split("=", 1) for line in output.splitlines())
        self.assertNotIn("ANDROID_HOME", exported)
        self.assertEqual(exported["PNPM_HOME"], str(self.home / ".local/share/pnpm"))
        self.assertEqual(exported["PATH"], f"{self.home}/.local/bin:{self.bin}")

    def test_development_paths_respect_overrides_and_do_not_duplicate(self):
        android = self.root / "custom SDK"
        pnpm = self.root / "custom pnpm"
        android_paths = [android / "cmdline-tools/latest/bin", android / "platform-tools"]
        for path in [*android_paths, pnpm / "bin"]:
            path.mkdir(parents=True)
        self.env.update(ANDROID_HOME=str(android), PNPM_HOME=str(pnpm),
                        PATH=f"{self.bin}:/existing directory")
        output = self.run_zsh("""
source "$LUNA_TEST_CONFIG/zshrc"
source "$LUNA_TEST_CONFIG/zshrc"
print -r -- "$ANDROID_HOME"
print -r -- "$PNPM_HOME"
print -rl -- "${path[@]}"
""")
        lines = output.splitlines()
        self.assertEqual(lines[:2], [str(android), str(pnpm)])
        installed_paths = lines[2:]
        self.assertEqual(installed_paths[0], str(self.home / ".local/bin"))
        for path in [pnpm / "bin", self.home / ".local/bin"]:
            self.assertEqual(installed_paths.count(str(path)), 1)
        self.assertLess(installed_paths.index(str(self.bin)), installed_paths.index("/existing directory"))
        self.assertLess(installed_paths.index("/existing directory"), installed_paths.index(str(pnpm / "bin")))
        for path in android_paths:
            self.assertNotIn(str(path), installed_paths)

    def test_empty_development_overrides_use_defaults_and_xdg_data_home(self):
        self.env.update(ANDROID_HOME="", PNPM_HOME="", XDG_DATA_HOME=str(self.root / "custom data"))
        output = self.run_zsh("""
source "$LUNA_TEST_CONFIG/zshrc"
print -r -- "$ANDROID_HOME"
print -r -- "$PNPM_HOME"
""")
        self.assertEqual(output.splitlines(), ["", str(self.root / "custom data/pnpm")])

    def test_interactive_source_initializes_completions_and_activates_once(self):
        self.add_generated_completion()
        output = self.run_zsh("""
source "$LUNA_TEST_CONFIG/zshrc"
before_options=$(setopt)
source "$LUNA_TEST_CONFIG/zshrc"
[[ "$(setopt)" == "$before_options" ]] || exit 1
(( ! ${+luna_zsh_dir} )) || exit 1
(( ! ${+luna_mise_activation} && ! ${+luna_mise_completion} )) || exit 1
print -r -- "$LUNA_TEST_ACTIVATIONS:$LUNA_TEST_COMPLETIONS:${#precmd_functions}"
print -r -- "${_comps[mise]}"
""", interactive=True)
        self.assertEqual(output.splitlines(), ["1:1:1", "_luna_test_mise_completion"])
        self.assertEqual(list(self.home.iterdir()), [])
        self.assertEqual(self.log.read_text(), "activate zsh\n")

    def test_existing_mise_and_completion_registration_are_preserved(self):
        self.add_generated_completion()
        output = self.run_zsh("""
_mise_hook() { return 0; }
compdef() { print -u2 -- "Do not replace my completion"; return 1; }
typeset -gA _comps=(mise _personal_mise)
source "$LUNA_TEST_CONFIG/zshrc"
print -r -- "${LUNA_TEST_ACTIVATIONS:-0}:${LUNA_TEST_COMPLETIONS:-0}:${_comps[mise]}"
""", interactive=True)
        self.assertEqual(output.strip(), "0:0:_personal_mise")
        self.assertFalse(self.log.exists())

    def test_generated_mise_completion_replaces_automatic_system_registration(self):
        self.add_generated_completion()
        completion_dir = self.root / "completions"
        completion_dir.mkdir()
        (completion_dir / "_mise").write_text("#compdef mise\nreturn 0\n")
        self.env["LUNA_TEST_COMPLETION_DIR"] = str(completion_dir)
        output = self.run_zsh("""
fpath=("$LUNA_TEST_COMPLETION_DIR" "${fpath[@]}")
source "$LUNA_TEST_CONFIG/zshrc"
source "$LUNA_TEST_CONFIG/zshrc"
print -r -- "$LUNA_TEST_COMPLETIONS:${_comps[mise]}"
""", interactive=True)
        self.assertEqual(output.strip(), "1:_luna_test_mise_completion")

    def test_missing_generated_completion_leaves_interactive_startup_quiet(self):
        self.assertEqual(self.run_zsh('source "$LUNA_TEST_CONFIG/zshrc"', interactive=True), "")

    def test_removed_mise_skips_stale_generated_scripts(self):
        self.add_generated_completion()
        self.mise.unlink()
        output = self.run_zsh("""
source "$LUNA_TEST_CONFIG/zshrc"
print -r -- "${LUNA_TEST_ACTIVATIONS:-0}:${LUNA_TEST_COMPLETIONS:-0}:$+functions[compdef]"
""", interactive=True)
        self.assertEqual(output.strip(), "0:0:1")

    def test_completions_work_without_optional_tools(self):
        self.mise.unlink()
        output = self.run_zsh("""
source "$LUNA_TEST_CONFIG/zshrc"
source "$LUNA_TEST_CONFIG/zshrc"
_personal_completion() { return 0; }
compdef _personal_completion personal
print -r -- "${_comps[personal]}"
""", interactive=True)
        self.assertEqual(output.strip(), "_personal_completion")

    def test_failed_activation_is_not_evaluated_and_completion_still_loads(self):
        self.add_generated_completion()
        self.env["LUNA_TEST_MISE_FAIL"] = "1"
        output = self.run_zsh("""
source "$LUNA_TEST_CONFIG/zshrc"
(( ! ${+LUNA_TEST_FAILED_ACTIVATION} )) || exit 1
print -r -- "${LUNA_TEST_ACTIVATIONS:-0}:$LUNA_TEST_COMPLETIONS:${_comps[mise]}"
""", interactive=True)
        self.assertEqual(output.strip(), "0:1:_luna_test_mise_completion")

    def test_starship_initializes_once_after_mise(self):
        self.add_starship()
        output = self.run_zsh("""
source "$LUNA_TEST_CONFIG/zshrc"
source "$LUNA_TEST_CONFIG/zshrc"
print -r -- "$LUNA_TEST_PROMPTS:$LUNA_TEST_ACTIVATIONS"
print -rl -- "${precmd_functions[@]}"
""", interactive=True)
        self.assertEqual(output.splitlines(), ["1:1", "_mise_hook", "prompt_starship_precmd"])

    def test_existing_starship_initialization_is_preserved(self):
        self.add_starship()
        output = self.run_zsh("""
prompt_starship_precmd() { print -r -- preserved; }
source "$LUNA_TEST_CONFIG/zshrc"
print -r -- "${LUNA_TEST_PROMPTS:-0}"
prompt_starship_precmd
""", interactive=True)
        self.assertEqual(output.splitlines(), ["0", "preserved"])

    def test_failed_starship_initialization_does_not_evaluate_partial_output(self):
        self.add_starship()
        self.env["LUNA_TEST_STARSHIP_FAIL"] = "1"
        output = self.run_zsh("""
source "$LUNA_TEST_CONFIG/zshrc"
(( ! ${+LUNA_TEST_FAILED_STARSHIP} )) || exit 1
print -r -- "${LUNA_TEST_PROMPTS:-0}"
""", interactive=True)
        self.assertEqual(output.strip(), "0")


if __name__ == "__main__":
    unittest.main()
