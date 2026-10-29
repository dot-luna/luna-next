"""Validate the installed Lua configuration without touching the running desktop."""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


APP = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).resolve().parent / "fixtures"
LUA = shutil.which("lua")


@unittest.skipUnless(LUA, "Lua is needed to exercise the native configuration")
class HyprlandConfigTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="luna-next hypr '")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.home = self.root / "home"
        self.config = self.root / "config"
        self.home.mkdir()
        self.installed = self.config / "luna-next/hypr"
        shutil.copytree(APP / "config", self.installed)
        self.entry = self.installed / "hyprland.lua"
        self.link = self.config / "hypr/hyprland.lua"
        self.link.parent.mkdir()
        self.link.symlink_to(self.entry)
        runtime = self.root / "runtime"
        runtime.mkdir(mode=0o700)
        self.env = dict(os.environ, HOME=str(self.home), XDG_CONFIG_HOME=str(self.config),
                        XDG_DATA_HOME=str(self.root / "data"), XDG_STATE_HOME=str(self.root / "state"),
                        XDG_CACHE_HOME=str(self.root / "cache"), XDG_RUNTIME_DIR=str(runtime))
        for name in ("DISPLAY", "WAYLAND_DISPLAY", "HYPRLAND_INSTANCE_SIGNATURE"):
            self.env.pop(name, None)

    def lua(self, script, fixture="native", entry=None):
        result = subprocess.run(
            [LUA, "-E", "-", str(entry or self.entry)],
            input=(FIXTURES / f"{fixture}.lua").read_text() + "\n" + script,
            cwd=self.root, env=self.env, text=True, capture_output=True, timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_installed_symlink_loads_sibling_modules(self):
        self.lua('''
dofile(arg[1])
assert(calls.monitor.output == "" and calls.monitor.mode == "preferred")
assert(calls.monitor.position == "auto" and calls.monitor.scale == 1)
local input, appearance
for _, settings in ipairs(calls) do
    input = input or settings.input
    appearance = appearance or settings.decoration
end
assert(input.repeat_rate == 40 and input.repeat_delay == 250)
assert(appearance.active_opacity == 0.9)
assert(#commands == 0, "loading configuration must not launch applications")
''', entry=self.link)

    def test_bindings_are_unique_described_and_use_available_integrations(self):
        self.lua('''
dofile(arg[1])
assert(bindings["SUPER + Return"].dispatcher.options == "xdg-terminal-exec")
assert(bindings["SUPER + SHIFT + Return"].dispatcher.options ==
    'gtk-launch -- "$(xdg-mime query default x-scheme-handler/https)"')
assert(bindings["SUPER + F"].dispatcher.options.layout_aware == false)
assert(bindings["SUPER + CTRL + L"] and bindings["SUPER + CTRL + Z"])
for workspace = 1, 10 do
    local key = tostring(workspace % 10)
    assert(bindings["SUPER + " .. key].dispatcher.options.workspace == workspace)
    assert(bindings["SUPER + SHIFT + " .. key].dispatcher.options.follow == true)
    assert(bindings["SUPER + SHIFT + ALT + " .. key].dispatcher.options.follow == false)
end
assert(bindings["SUPER + S"].dispatcher.options == "luna-next-scratchpad")
for _, entry in pairs(bindings) do
    if type(entry.dispatcher) == "table" and entry.dispatcher.kind == "exec" then
        assert(entry.dispatcher.options == "xdg-terminal-exec" or
            entry.dispatcher.options:match("^gtk%-launch "), "unsupported application shortcut")
    end
end
assert(not bindings["Print"] and not bindings["XF86AudioRaiseVolume"])
assert(not bindings["SUPER + Space"] and not bindings["SUPER + L"])
bindings["SUPER + grave"].dispatcher()
assert(#commands == 1 and #timers == 1)
assert(commands[1].options ==
    'flock -n "${XDG_RUNTIME_DIR:?}/luna-next-dropdown-${HYPRLAND_INSTANCE_SIGNATURE:?}.lock" kitty --class luna-next-dropdown')
''')

    def test_only_startup_launches_wallpaper(self):
        self.lua('''
dofile(arg[1])
assert(#commands == 0)
fire("config.reloaded")
assert(#commands == 0, "configuration reload must not restart wallpaper")
fire("hyprland.start")
assert(#commands == 1 and commands[1].kind == "exec")
assert(commands[1].options ==
    'QML_IMPORT_PATH="$HOME/.local/lib/qt6/qml${QML_IMPORT_PATH:+:$QML_IMPORT_PATH}" "$HOME/.local/bin/lnxt" wallpaper start')
''')

    def test_workspace_ranges_follow_physical_order_and_hotplug(self):
        self.lua('''
local right = monitor("right", 1920)
local left = monitor("left", 0)
local second = workspace(right, 2, { is_empty = false })
local ninth = workspace(left, 9, { is_empty = false })
load_workspaces()
update("config.reloaded")
for id = 1, 10 do assert(assignment(id) == (id <= 5 and "left" or "right")) end
assert(second.monitor == left and ninth.monitor == right)
local count = #rules
update("monitor.layout_changed")
assert(#rules == count, "unchanged layout duplicated workspace rules")
local third = monitor("third", 3840)
update("monitor.added")
for id = 1, 10 do
    assert(assignment(id) == (id <= 4 and "left" or id <= 7 and "right" or "third"))
end
monitors = { left }
update("monitor.removed")
for id = 1, 10 do assert(assignment(id) == "left") end
monitors = { right, left }
left.x = 3000
update("monitor.layout_changed")
for id = 1, 10 do assert(assignment(id) == (id <= 5 and "right" or "left")) end
''', fixture="workspaces")

    def test_hotplug_repairs_overflow_without_stealing_focus(self):
        self.lua('''
local left = monitor("left", 0)
local first = workspace(left, 1, { active = true, is_empty = false })
local window = { workspace = first, mapped = true, address = "0x1234" }
first.window = window
active_monitor, active_window = left, window
load_workspaces()
update("config.reloaded")
local right = monitor("right", 1920)
workspace(right, 11, { active = true })
update("monitor.added")
assert(right.active_workspace.id == 6 and not get_workspace(11))
assert(active_window == window and active_monitor == left, "hotplug stole keyboard focus")
assert(cursor.x == 360 and cursor.y == 220, "hotplug warped the pointer")
''', fixture="workspaces")

    def test_unchanged_topology_repairs_overflow_and_restores_monitor_focus(self):
        self.lua('''
local left = monitor("left", 0)
local right = monitor("right", 1920)
workspace(left, 1, { active = true })
active_monitor = left
load_workspaces()
update("config.reloaded")
local count = #rules
workspace(right, 11, { active = true })
update("monitor.layout_changed")
assert(right.active_workspace.id == 6 and not get_workspace(11))
assert(#rules == count)
assert(active_monitor == left and active_window == nil)
assert(cursor.x == 360 and cursor.y == 220)
''', fixture="workspaces")

    def test_overflow_repair_preserves_user_workspaces(self):
        for options in ('is_empty = false', 'is_persistent = true', 'name = "project"'):
            with self.subTest(options=options):
                self.lua('''
local left = monitor("left", 0)
local right = monitor("right", 1920)
workspace(left, 1, { active = true })
local original = workspace(right, 11, { active = true, OPTIONS })
active_monitor = left
load_workspaces()
update("monitor.added")
assert(right.active_workspace == original and get_workspace(11) == original)
assert(active_monitor == left and cursor.x == 360 and cursor.y == 220)
'''.replace("OPTIONS", options), fixture="workspaces")

    def test_native_hyprland_verification(self):
        executable = shutil.which("Hyprland")
        if not executable:
            self.skipTest("Hyprland is needed for native configuration verification")
        help_result = subprocess.run([executable, "--help"], env=self.env,
                                     text=True, capture_output=True, check=True, timeout=10)
        if "--verify-config" not in help_result.stdout + help_result.stderr:
            self.skipTest("This Hyprland version has no configuration verification")
        result = subprocess.run([executable, "--verify-config", "-c", str(self.link)],
                                cwd=self.root, env=self.env, text=True, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("config ok", result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
