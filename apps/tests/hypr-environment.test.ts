import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

for (const existing of [
  "",
  "/system/qml:/custom/qml",
  "/fixture/home/.local/lib/qt6/qml:/system/qml",
]) {
  test(`Hyprland publishes QML imports once while retaining ${existing || "an empty path"}`, () => {
    const path = fileURLToPath(new URL("../hypr/config/env.lua", import.meta.url));
    const script = `
local env = { HOME = "/fixture/home", QML_IMPORT_PATH = arg[2] }
os.getenv = function(name) return env[name] end
hl = { env = function(name, value) env[name] = value end }
io.popen = function(command)
  return {read = function() return command:find(" theme path ", 1, true) and "/fixture/theme" or "tokyo-night" end,
          close = function() end}
end
local configure = dofile(arg[1])
configure("/fixture/config/luna/hypr")
configure("/fixture/config/luna/hypr")
print(env.QML_IMPORT_PATH)
`;
    const result = Bun.spawnSync(["lua", "-", path, existing], { stdin: Buffer.from(script) });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    const paths = result.stdout.toString().trim().split(":");
    expect(paths.filter((path) => path === "/fixture/home/.local/lib/qt6/qml")).toHaveLength(1);
    expect(paths[0]).toBe("/fixture/home/.local/lib/qt6/qml");
    for (const path of existing.split(":").filter(Boolean)) expect(paths).toContain(path);
  });
}
