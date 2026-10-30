"""Exercise optional shell tools in an isolated interactive Zsh."""

from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import unittest


REPO = Path(__file__).resolve().parents[3]
ZSH = shutil.which("zsh")


@unittest.skipUnless(ZSH, "Zsh is required")
class ZshToolsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="luna tools '")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.log = self.root / "calls"
        self.env = {
            "HOME": str(self.home),
            "ZDOTDIR": str(self.home),
            "PATH": str(self.bin),
            "TERM": "xterm",
            "LUNA_TEST_MODULES": str(REPO / "apps/zsh/config/zsh"),
            "LUNA_TEST_LOG": str(self.log),
        }

    def add_command(self, name, body="exit 0\n"):
        target = self.bin / name
        target.write_text("#!/bin/sh\n" + body)
        target.chmod(0o755)

    def add_zoxide(self):
        self.add_command("zoxide", """
printf 'zoxide:%s\n' "$*" >> "$LUNA_TEST_LOG"
[ "$*" = 'init zsh' ] || exit 2
if [ "${LUNA_TEST_FAIL:-}" = 1 ]; then
    printf '%s\n' 'export LUNA_TEST_PARTIAL_INIT=1'
    exit 1
fi
/bin/cat <<'INIT'
__zoxide_z() { builtin cd -- "$@"; }
__zoxide_hook() { return 0; }
z() {
    (( LUNA_TEST_Z_CALLS += 1 ))
    __zoxide_z "$@"
}
zi() { return 0; }
typeset -ga precmd_functions
precmd_functions+=(__zoxide_hook)
INIT
""")

    def add_fzf(self):
        self.add_command("fzf", """
printf 'fzf:%s\n' "$*" >> "$LUNA_TEST_LOG"
[ "$*" = '--zsh' ] || exit 2
if [ "${LUNA_TEST_FAIL:-}" = 1 ]; then
    printf '%s\n' 'export LUNA_TEST_PARTIAL_INIT=1'
    exit 1
fi
/bin/cat <<'INIT'
fzf-history-widget() { return 0; }
fzf-file-widget() { return 0; }
fzf-cd-widget() { return 0; }
zle -N fzf-history-widget
bindkey '^R' fzf-history-widget
if [[ "${FZF_CTRL_T_COMMAND-x}" != '' ]]; then
    zle -N fzf-file-widget
    bindkey '^T' fzf-file-widget
fi
if [[ "${FZF_ALT_C_COMMAND-x}" != '' ]]; then
    zle -N fzf-cd-widget
    bindkey '\\ec' fzf-cd-widget
fi
INIT
""")

    def add_recording_command(self, name):
        self.add_command(name, 'printf "%s\\0" "$0" "$@" > "$LUNA_TEST_LOG"\n')

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

    def get_preview(self, variable):
        output = self.run_zsh(f'''
source "$LUNA_TEST_MODULES/tools.zsh"
print -r -- "${{{variable}}}"
''')
        options = shlex.split(output.strip())
        self.assertEqual(len(options), 2)
        self.assertEqual(options[0], "--preview")
        return options[1]

    def run_preview(self, command, filename):
        # fzf substitutes shell-quoted paths into every placeholder before execution.
        result = subprocess.run(
            ["/bin/sh", "-c", command.replace("{}", shlex.quote(filename))],
            env=self.env, cwd=self.root, capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        return self.log.read_bytes().decode().rstrip("\0").split("\0")

    def test_missing_commands_skip_cleanly(self):
        output = self.run_zsh('''
source "$LUNA_TEST_MODULES/tools.zsh"
print -r -- "$+aliases[cd]:$+aliases[cdi]:$+functions[fzf-history-widget]:$+aliases[ll]"
print -r -- "${+FZF_DEFAULT_COMMAND}:${+FZF_CTRL_T_OPTS}"
''')
        self.assertEqual(output.splitlines(), ["0:0:0:0", "0:0"])
        self.assertFalse(self.log.exists())

    def test_noninteractive_shell_skips_integrations(self):
        self.add_zoxide()
        self.add_fzf()
        self.add_command("eza")
        output = self.run_zsh('''
source "$LUNA_TEST_MODULES/tools.zsh"
print -r -- "$+aliases[cd]:$+aliases[cdi]:$+functions[fzf-history-widget]:$+aliases[ll]"
''', interactive=False)
        self.assertEqual(output.strip(), "0:0:0:0")
        self.assertFalse(self.log.exists())

    def test_zoxide_aliases_cd_once_and_persists_outside_module_function(self):
        self.add_zoxide()
        destination = self.root / "directory with ' spaces"
        destination.mkdir()
        self.env["LUNA_TEST_DESTINATION"] = str(destination)
        output = self.run_zsh('''
() {
    source "$LUNA_TEST_MODULES/tools.zsh"
    source "$LUNA_TEST_MODULES/tools.zsh"
}
eval 'cd "$LUNA_TEST_DESTINATION"'
print -r -- "$PWD"
print -r -- "$aliases[cd]:$aliases[cdi]:$LUNA_TEST_Z_CALLS"
print -r -- "${#precmd_functions}:$+functions[z]:$+functions[zi]:${+luna_zoxide_init}"
''')
        self.assertEqual(output.splitlines(), [str(destination), "z:zi:1", "1:1:1:0"])
        self.assertEqual(self.log.read_text(), "zoxide:init zsh\n")

    def test_zoxide_reuses_existing_default_functions_for_aliases(self):
        self.add_zoxide()
        output = self.run_zsh('''
__zoxide_z() { print -r -- existing-navigation; }
z() { __zoxide_z "$@"; }
zi() { print -r -- existing-picker; }
source "$LUNA_TEST_MODULES/tools.zsh"
source "$LUNA_TEST_MODULES/tools.zsh"
print -r -- "$aliases[cd]:$aliases[cdi]"
eval 'cd'
eval 'cdi'
''')
        self.assertEqual(output.splitlines(), ["z:zi", "existing-navigation", "existing-picker"])
        self.assertFalse(self.log.exists())

    def test_zoxide_failure_does_not_evaluate_partial_output(self):
        self.add_zoxide()
        self.env["LUNA_TEST_FAIL"] = "1"
        output = self.run_zsh('''
source "$LUNA_TEST_MODULES/tools.zsh"
print -r -- "$+aliases[cd]:$+aliases[cdi]:$+functions[z]:${+LUNA_TEST_PARTIAL_INIT}"
''')
        self.assertEqual(output.strip(), "0:0:0:0")

    def test_zoxide_incomplete_initialization_does_not_create_aliases(self):
        self.add_command("zoxide")
        output = self.run_zsh('''
source "$LUNA_TEST_MODULES/tools.zsh"
print -r -- "$+aliases[cd]:$+aliases[cdi]"
''')
        self.assertEqual(output.strip(), "0:0")

    def test_fzf_sets_fd_defaults_and_installs_three_shortcuts_once(self):
        self.add_fzf()
        self.add_command("fd")
        output = self.run_zsh('''
before_options=$(setopt)
() {
    source "$LUNA_TEST_MODULES/tools.zsh"
    source "$LUNA_TEST_MODULES/tools.zsh"
}
[[ "$(setopt)" == "$before_options" ]] || exit 1
print -r -- "$FZF_DEFAULT_COMMAND"
print -r -- "$FZF_CTRL_T_COMMAND"
print -r -- "$FZF_ALT_C_COMMAND"
bindkey '^R'
bindkey '^T'
bindkey '\\ec'
print -r -- "${+luna_fzf_init}:${+luna_fzf_directory_preview}"
''')
        self.assertEqual(output.splitlines(), [
            "command fd --type f --hidden --exclude .git",
            "command fd --type f --hidden --exclude .git",
            "command fd --type d --hidden --exclude .git",
            '"^R" fzf-history-widget',
            '"^T" fzf-file-widget',
            '"^[c" fzf-cd-widget',
            "0:0",
        ])
        self.assertEqual(self.log.read_text(), "fzf:--zsh\n")

    def test_fzf_without_fd_keeps_builtin_finders(self):
        self.add_fzf()
        output = self.run_zsh('''
source "$LUNA_TEST_MODULES/tools.zsh"
print -r -- "${+FZF_DEFAULT_COMMAND}:${+FZF_CTRL_T_COMMAND}:${+FZF_ALT_C_COMMAND}"
print -r -- "${+FZF_CTRL_T_OPTS}"
''')
        self.assertEqual(output.splitlines(), ["0:0:0", "0"])

    def test_explicit_empty_fzf_settings_disable_shortcuts_and_previews(self):
        self.add_fzf()
        for tool in ("fd", "bat", "eza"):
            self.add_command(tool)
        settings = ("FZF_DEFAULT_COMMAND", "FZF_CTRL_T_COMMAND", "FZF_ALT_C_COMMAND",
                    "FZF_CTRL_T_OPTS", "FZF_ALT_C_OPTS")
        self.env.update(dict.fromkeys(settings, ""))
        output = self.run_zsh('''
source "$LUNA_TEST_MODULES/tools.zsh"
print -r -- "$FZF_DEFAULT_COMMAND:$FZF_CTRL_T_COMMAND:$FZF_ALT_C_COMMAND"
print -r -- "$FZF_CTRL_T_OPTS:$FZF_ALT_C_OPTS"
bindkey '^T'
bindkey '\\ec'
''')
        lines = output.splitlines()
        self.assertEqual(lines[:2], ["::", ":"])
        self.assertNotIn("fzf-file-widget", lines[2])
        self.assertNotIn("fzf-cd-widget", lines[3])

    def test_custom_fzf_settings_and_existing_widget_are_preserved(self):
        self.add_fzf()
        for tool in ("fd", "bat", "eza"):
            self.add_command(tool)
        settings = {
            "FZF_DEFAULT_COMMAND": "personal files",
            "FZF_CTRL_T_COMMAND": "personal selection",
            "FZF_ALT_C_COMMAND": "personal directories",
            "FZF_DEFAULT_OPTS": "--border",
            "FZF_CTRL_T_OPTS": "--preview 'personal {}'",
            "FZF_CTRL_R_OPTS": "--reverse",
            "FZF_ALT_C_OPTS": "--height=50%",
        }
        self.env.update(settings)
        output = self.run_zsh('''
fzf-history-widget() { print -r -- personal; }
source "$LUNA_TEST_MODULES/tools.zsh"
fzf-history-widget
''' + "\n".join(f'print -r -- "${{{key}}}"' for key in settings))
        self.assertEqual(output.splitlines(), ["personal", *settings.values()])
        self.assertFalse(self.log.exists())

    def test_fzf_failure_does_not_evaluate_partial_output(self):
        self.add_fzf()
        self.env["LUNA_TEST_FAIL"] = "1"
        output = self.run_zsh('''
source "$LUNA_TEST_MODULES/tools.zsh"
print -r -- "$+functions[fzf-history-widget]:${+LUNA_TEST_PARTIAL_INIT}"
''')
        self.assertEqual(output.strip(), "0:0")

    def test_bat_preview_quotes_file_names_and_ends_option_parsing(self):
        self.add_fzf()
        self.add_recording_command("bat")
        self.add_recording_command("eza")
        filename = "-a file '$(touch injected); name"
        (self.root / filename).write_text("sample\n")
        preview = self.get_preview("FZF_CTRL_T_OPTS")
        args = self.run_preview(preview, filename)
        self.assertEqual(args[0], str(self.bin / "bat"))
        self.assertEqual(args[-2:], ["--", filename])
        self.assertIn("--paging=never", args)
        self.assertFalse((self.root / "injected").exists())

    def test_file_and_directory_widgets_preview_directories_with_eza(self):
        self.add_fzf()
        self.add_recording_command("bat")
        self.add_recording_command("eza")
        dirname = "-a directory ' with spaces"
        (self.root / dirname).mkdir()
        for variable in ("FZF_CTRL_T_OPTS", "FZF_ALT_C_OPTS"):
            with self.subTest(variable=variable):
                args = self.run_preview(self.get_preview(variable), dirname)
                self.assertEqual(args[0], str(self.bin / "eza"))
                self.assertEqual(args[-2:], ["--", dirname])

    def test_directory_preview_falls_back_to_ls(self):
        self.add_fzf()
        self.add_recording_command("bat")
        self.add_recording_command("ls")
        dirname = "-directory with spaces"
        (self.root / dirname).mkdir()
        args = self.run_preview(self.get_preview("FZF_CTRL_T_OPTS"), dirname)
        self.assertEqual(args[0], str(self.bin / "ls"))
        self.assertEqual(args[-2:], ["--", dirname])

    def test_eza_shortcuts_keep_paths_literal_and_original_commands_available(self):
        self.add_recording_command("eza")
        self.env["LUNA_TEST_DESTINATION"] = "-directory with ' spaces"
        output = self.run_zsh('''
source "$LUNA_TEST_MODULES/tools.zsh"
source "$LUNA_TEST_MODULES/tools.zsh"
eval 'll -- "$LUNA_TEST_DESTINATION"'
print -r -- "$aliases[la]"
print -r -- "$aliases[lt]"
print -r -- "$+aliases[ls]:$+aliases[cat]"
''')
        args = self.log.read_bytes().decode().rstrip("\0").split("\0")
        self.assertEqual(args[-2:], ["--", self.env["LUNA_TEST_DESTINATION"]])
        self.assertIn("--git", args)
        self.assertIn("--long", args)
        self.assertIn("--all", output.splitlines()[0])
        self.assertIn("--level=2", output.splitlines()[1])
        self.assertEqual(output.splitlines()[2], "0:0")

    def test_eza_shortcuts_preserve_personal_aliases_and_functions(self):
        self.add_command("eza")
        output = self.run_zsh('''
alias ll='personal-list --long'
la() { print -r -- personal-list; }
source "$LUNA_TEST_MODULES/tools.zsh"
print -r -- "$aliases[ll]:$+aliases[la]"
la
''')
        self.assertEqual(output.splitlines(), ["personal-list --long:0", "personal-list"])


if __name__ == "__main__":
    unittest.main()
