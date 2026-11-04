import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("Hyprland screenshot shortcuts preserve the old modes without repeating captures", () => {
  const path = fileURLToPath(new URL("../../apps/hypr/config/bindings/apps.lua", import.meta.url));
  const result = Bun.spawnSync(["lua", "-", path], {
    stdin: Buffer.from(`
hl = { dsp = { exec_cmd = function(command) return command end } }
dofile(arg[1])(function(keys, command, description, options)
  if command:find(" screenshot ", 1, true) then
    print(keys .. "\\t" .. command .. "\\t" .. tostring(options.repeating))
  end
end)
`),
  });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  expect(result.stdout.toString().trim().split("\n")).toEqual([
    'Print\t"$HOME/.local/bin/luna" screenshot region\tfalse',
    'SHIFT + Print\t"$HOME/.local/bin/luna" screenshot screen\tfalse',
    'ALT + Print\t"$HOME/.local/bin/luna" screenshot window\tfalse',
    'CTRL + Print\t"$HOME/.local/bin/luna" screenshot all\tfalse',
  ]);
});
