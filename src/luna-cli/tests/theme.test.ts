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
  expect(f.read(f.env.THEME_PREFERENCE!)).toBe("prefer-dark");
  expect(f.read(f.env.LUNA_TEST_GTK_THEME!)).toBe("'Luna'");
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

test("theme mode and toggle commands synchronize GTK appearance", async () => {
  f.write(f.env.THEME_PREFERENCE!, "prefer-dark");
  f.write(f.env.LUNA_TEST_GTK_THEME!, "'Adwaita'");
  const mode = await cli([...flags(), "mode", "dark", "--json"]);
  expect(mode.code, mode.stdout + mode.stderr).toBe(0);
  expect(JSON.parse(mode.stdout)).toEqual({ succes: true, data: "dark" });
  expect(f.read(f.env.LUNA_TEST_GTK_THEME!)).toBe("'Luna'");

  const toggle = await cli([...flags(), "toggle", "--json"]);
  expect(toggle.code, toggle.stdout + toggle.stderr).toBe(0);
  expect(JSON.parse(toggle.stdout)).toEqual({ succes: true, data: "light" });
  expect(f.read(f.env.THEME_PREFERENCE!)).toBe("prefer-light");
  expect(f.read(f.env.LUNA_TEST_GTK_THEME!)).toBe("'Luna-alt'");
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

test("theme info and dry-run describe uninstalled files; generic imports need --name", async () => {
  const source = join(f.root, "config.jsonc");
  f.write(source, '{"fonts":{"ui":"Example"}}');
  const info = await cli([...flags(), "info", source, "--json"]);
  expect(info.code, info.stdout + info.stderr).toBe(0);
  expect(JSON.parse(info.stdout)).toMatchObject({
    succes: true,
    data: { suggestedName: "config", needsName: true, fonts: { ui: "Example" } },
  });
  expect(existsSync(f.libraryDir)).toBe(false);
  expect((await cli([...flags(), "info", source])).stdout).toContain("Fonts: Example");
  const missing = await cli([...flags(), "install", source, "--json"]);
  expect(JSON.parse(missing.stdout)).toMatchObject({ succes: false, err: "INPUT_REQUIRED" });
  expect((await cli([...flags(), "install", source, "--dry-run", "--json"])).code).toBe(0);
  expect(existsSync(f.libraryDir)).toBe(false);
  expect((await cli([...flags(), "install", source, "--name", "custom", "--json"])).code).toBe(0);
  expect((await cli([...flags(), "random", "--json"])).code).toBe(0);
});

test("remote CLI imports expose info before requiring download approval", async () => {
  let assets = 0;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      if (new URL(request.url).pathname === "/night.json")
        return new Response('{"wallpaper":{"sources":["night.svg"]}}');
      assets++;
      return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>');
    },
  });
  try {
    const source = `${server.url}night.json`;
    const pending = await cli([...flags(), "install", source, "--json"]);
    expect(JSON.parse(pending.stdout)).toMatchObject({ succes: false, err: "INPUT_REQUIRED" });
    expect(assets).toBe(0);
    const preview = await cli([...flags(), "install", source, "--dry-run", "--json"]);
    expect(
      JSON.parse(preview.stdout).data.files.map((file: { path: string }) => file.path),
    ).toEqual(["theme.json", "night.svg"]);
    expect(assets).toBe(0);
    const installed = await cli([...flags(), "install", source, "--yes", "--json"]);
    expect(installed.code, installed.stdout + installed.stderr).toBe(0);
    expect(assets).toBe(1);
  } finally {
    await server.stop(true);
  }
});
