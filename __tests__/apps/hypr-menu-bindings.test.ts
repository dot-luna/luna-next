import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("Hyprland menu and lock shortcuts invoke the installed Luna commands", () => {
  const path = fileURLToPath(new URL("../../apps/hypr/config/bindings/apps.lua", import.meta.url));
  const script = `
hl = { dsp = { exec_cmd = function(command) return command end } }
dofile(arg[1])(function(keys, command)
  print(keys .. "\\t" .. command)
end)
`;
  const result = Bun.spawnSync(["lua", "-", path], { stdin: Buffer.from(script) });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  const bindings = Object.fromEntries(
    result.stdout
      .toString()
      .trim()
      .split("\n")
      .map((line) => line.split("\t")),
  );
  expect(bindings["SUPER + SHIFT + F"]).toBe('xdg-open "$HOME"');
  expect(bindings["SUPER + B"]).toBe('"$HOME/.local/bin/luna" bar focus');
  expect(bindings["SUPER + E"]).toBe('"$HOME/.local/bin/luna" emoji');
  expect(bindings["SUPER + V"]).toBe('"$HOME/.local/bin/luna" clipboard');
  expect(bindings["SUPER + Escape"]).toBe('"$HOME/.local/bin/luna" menu system');
  expect(bindings["SUPER + Space"]).toBe('"$HOME/.local/bin/luna" menu toggle');
  expect(bindings["SUPER + L"]).toBe('"$HOME/.local/bin/luna" lock');
});

test("About uses Super+Shift+A without taking the file explorer shortcut", () => {
  const path = fileURLToPath(new URL("../../apps/fastfetch/config/hyprland.lua", import.meta.url));
  const script = `
hl = { window_rule = function() end, dsp = { exec_cmd = function(command) return command end },
  bind = function(keys, command, options)
    assert(keys == "SUPER + SHIFT + A")
    assert(options.description == "About")
    assert(command:find("fastfetch --pipe false", 1, true))
    print(keys)
  end }
dofile(arg[1])
`;
  const result = Bun.spawnSync(["lua", "-", path], { stdin: Buffer.from(script) });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  expect(result.stdout.toString().trim()).toBe("SUPER + SHIFT + A");
});
