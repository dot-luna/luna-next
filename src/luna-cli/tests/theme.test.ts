import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { ThemeFixture } from "../../../packages/luna-api/tests/fixtures/theme-fixture.ts";

let f: ThemeFixture;
const entry = resolve(import.meta.dir, "../src/index.ts");
beforeEach(() => {
  f = new ThemeFixture();
});
afterEach(() => f.dispose());
async function cli(args: string[], executable?: string) {
  const child = Bun.spawn(executable ? [executable, ...args] : [process.execPath, entry, ...args], {
    env: f.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}
const flags = () => ["theme", "--config-file", f.configFile, "--library-dir", f.libraryDir];

test("theme CLI installs JSONC, selects, resolves, lists and protects the active theme", async () => {
  const source = f.source("custom", '{"colors":{"accent":"#ffffff"}}');
  const install = await cli([...flags(), "install", source, "--json"]);
  expect(install.code, install.stdout + install.stderr).toBe(0);
  expect(JSON.parse(install.stdout)).toEqual({ succes: true, data: join(f.libraryDir, "custom") });
  const selected = await cli([...flags(), "set", "custom", "--json"]);
  expect(selected.code, selected.stdout + selected.stderr).toBe(0);
  const get = await cli([...flags(), "get", "colors.accent_foreground", "--json"]);
  expect(JSON.parse(get.stdout)).toEqual({ succes: true, data: "#000000" });
  expect(get.stderr).toBe("");
  expect((await cli([...flags(), "current"])).stdout).toBe("custom\n");
  expect((await cli([...flags(), "list"])).stdout).toBe("* custom\n");
  expect((await cli([...flags(), "hyprland"])).stdout).toStartWith("return {");
  expect(
    JSON.parse((await cli([...flags(), "hyprland", "--json"])).stdout).data.general.col
      .active_border,
  ).toBe("#ffffff");
  expect((await cli([...flags(), "remove", "custom", "--yes", "--json"])).code).toBe(1);
});

test("theme removal requires confirmation and supports a dry run", async () => {
  const source = f.source("custom");
  expect((await cli([...flags(), "install", source, "--json"])).code).toBe(0);
  const confirm = await cli([...flags(), "remove", "custom", "--json"]);
  expect(confirm.code).toBe(1);
  expect(JSON.parse(confirm.stdout)).toMatchObject({ succes: false, err: "INPUT_REQUIRED" });
  const preview = await cli([...flags(), "remove", "custom", "--dry-run", "--json"]);
  expect(preview.code).toBe(0);
  expect(existsSync(join(f.libraryDir, "custom"))).toBe(true);
  expect((await cli([...flags(), "remove", "custom", "--yes", "--json"])).code).toBe(0);
  expect(existsSync(join(f.libraryDir, "custom"))).toBe(false);
});

test("compiled CLI embeds defaults and supports theme reads without repository source", async () => {
  const executable = join(f.root, "luna");
  const build = Bun.spawnSync(
    [process.execPath, "build", "--compile", entry, "--outfile", executable],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(build.exitCode, build.stderr.toString()).toBe(0);
  const result = await cli([...flags(), "get", "fonts.mono", "--json"], executable);
  expect(result.code, result.stdout + result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ succes: true, data: "Iosevka Nerd Font" });
}, 15000);
