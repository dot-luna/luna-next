import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  lstatSync,
  readdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { Luna, type ApiResponse } from "../src/index.ts";
import { defaults } from "../src/theme/defaults.ts";
import { locked } from "../src/lib/files.ts";
import { themeContext } from "../src/theme/context.ts";
import { ThemeFixture } from "./fixtures/theme-fixture.ts";

let f: ThemeFixture;
beforeEach(() => {
  f = new ThemeFixture();
});
afterEach(() => f.dispose());
function data<T>(response: ApiResponse<T>): T {
  if (!response.succes) throw new Error(response.errMessage);
  return response.data;
}

test("bundled JSONC matches complete defaults and default reads create only an empty selection", async () => {
  expect(data(await Luna.theme.current(f.options))).toBeNull();
  expect(JSON.parse(f.read(f.configFile))).toEqual({});
  const value = data(await Luna.theme.get(undefined, f.options));
  expect(value).toEqual({ ...defaults, name: "tokyo-night" });
  const source = resolve(import.meta.dir, "../../../themes/bundled/tokyo-night");
  const path = data(await Luna.theme.install(source, f.options));
  expect(f.read(join(path, "theme.jsonc"))).toBe(f.read(join(source, "theme.jsonc")));
  const { packages, ...appearance } = data(await Luna.theme.inspect("tokyo-night", f.options));
  expect(value).toEqual(appearance);
  expect(packages).toEqual([
    { name: "ttf-iosevka-nerd", source: "pacman" },
    { name: "ttf-outfit", source: "aur" },
  ]);
  expect(data(await Luna.theme.current(f.options))).toBeNull();
});

test("XDG and Luna paths use JSONC under Luna runtime directories and explicit paths win", async () => {
  const options = {
    env: {
      HOME: f.home,
      XDG_CONFIG_HOME: join(f.root, "xdg-config"),
      XDG_DATA_HOME: join(f.root, "xdg-data"),
    },
  };
  expect(data(await Luna.theme.getConfigFile(options))).toBe(
    join(f.root, "xdg-config/luna/theme.jsonc"),
  );
  expect(data(await Luna.theme.path(undefined, options))).toBe(
    join(f.root, "xdg-data/luna/themes"),
  );
  expect(data(await Luna.theme.getConfigFile({ ...f.options, env: {} }))).toBe(f.configFile);
  expect((await Luna.theme.get({} as string, { env: {} })).succes).toBe(false);
});

test("partial themes derive readable pairs and keep authored comments unchanged", async () => {
  const text =
    '// author comment\n{"colors":{"accent":"#ffffff","success":"#000000"},"fonts":{"ui":"Custom UI"},"appearance":{"rounding":12,},}\n';
  const source = f.source("custom", text);
  const path = data(await Luna.theme.install(source, f.options));
  const theme = data(await Luna.theme.inspect("custom", f.options));
  expect(theme.colors.accent_foreground).toBe("#000000");
  expect(theme.colors.success_foreground).toBe("#ffffff");
  expect(theme.colors.success_emphasis).toBe("#000000");
  expect(theme.fonts).toEqual({ ui: "Custom UI", mono: "Iosevka Nerd Font" });
  expect(theme.appearance.rounding).toBe(12);
  expect(f.read(join(path, "theme.jsonc"))).toBe(text);
  data(await Luna.theme.set("custom", f.options));
  expect(data(await Luna.theme.get("missing.key", f.options))).toBeNull();
  expect(await Luna.theme.get("colors..accent", f.options)).toMatchObject({
    succes: false,
    err: "INVALID_ARGUMENT",
  });
  expect(data(await Luna.theme.list(f.options))).toEqual([{ name: "custom", current: true }]);
  const native = data(await Luna.theme.hyprland(f.options));
  expect(native.general.col.active_border).toBe("#ffffff");
  expect(native.decoration.rounding).toBe(12);
});

test("light defaults preserve explicit colors and selection does not rewrite palette mode", async () => {
  const source = f.source(
    "light",
    '{"colors":{"mode":"light","accent":"#ffffff","accent_foreground":"#123456"}}',
  );
  data(await Luna.theme.install(source, f.options));
  const value = data(await Luna.theme.set("light", f.options));
  expect(value.colors.background).toBe("#e1e2e7");
  expect(value.colors.accent_foreground).toBe("#123456");
  expect(data(await Luna.theme.mode(undefined, f.options))).toBe("light");
  expect(data(await Luna.theme.toggle(f.options))).toBe("dark");
  expect(data(await Luna.theme.get("colors.mode", f.options))).toBe("light");
});

test.each([
  [[]],
  { colors: { acccent: "#123456" } },
  { colors: { accent: "#1234" } },
  { colors: { mode: "auto" } },
  { fonts: { ui: " " } },
  { fonts: { ui: "bad\nfont" } },
  { appearance: { rounding: -1 } },
  { appearance: { opacity: { active: 1.1 } } },
  { appearance: { blur: { passes: 11 } } },
  { appearance: { gaps: { inner: 1.5 } } },
  { wallpaper: { sources: null } },
])("Zod rejects invalid source %j before replacing an installed copy", async (invalid) => {
  const source = f.source("custom");
  const path = data(await Luna.theme.install(source, f.options));
  f.write(join(source, "theme.jsonc"), JSON.stringify(invalid));
  expect(await Luna.theme.install(source, { ...f.options, force: true })).toMatchObject({
    succes: false,
    err: "INVALID_METADATA",
  });
  expect(f.read(join(path, "theme.jsonc"))).toBe("{}\n");
});

test("force exchanges complete folders without backups, while removal validates the whole batch", async () => {
  const source = f.source("custom");
  const installed = data(await Luna.theme.install(source, f.options));
  f.write(join(installed, "obsolete"), "remove me");
  expect(await Luna.theme.install(source, f.options)).toMatchObject({
    succes: false,
    err: "CONFLICT",
  });
  data(await Luna.theme.install(source, { ...f.options, force: true }));
  expect(existsSync(join(installed, "obsolete"))).toBe(false);
  expect(readdirSync(f.libraryDir)).toEqual(["custom"]);
  expect((await Luna.theme.remove(["custom", "missing"], f.options)).succes).toBe(false);
  expect(existsSync(installed)).toBe(true);
  expect(data(await Luna.theme.remove(["custom"], { ...f.options, dryRun: true }))).toEqual([
    installed,
  ]);
  data(await Luna.theme.set("custom", f.options));
  expect((await Luna.theme.remove(["custom"], f.options)).succes).toBe(false);
  f.write(f.configFile, "{}\n");
  expect(data(await Luna.theme.remove(["custom", "custom"], f.options))).toEqual([installed]);
  expect(existsSync(source)).toBe(true);
});

test("symlinks, escaping names and sources containing the library are rejected", async () => {
  const source = f.source("custom");
  for (const name of ["../escape", "/tmp/theme", "Wrong", ""])
    expect((await Luna.theme.install(source, { ...f.options, name })).succes).toBe(false);
  data(await Luna.theme.install(source, f.options));
  symlinkSync(source, join(f.libraryDir, "linked"));
  expect((await Luna.theme.path("linked", f.options)).succes).toBe(false);
  expect(
    (await Luna.theme.install(source, { ...f.options, name: "linked", force: true })).succes,
  ).toBe(false);
  f.write(join(f.root, "external"), "keep me");
  symlinkSync(join(f.root, "external"), join(source, "outside"));
  expect((await Luna.theme.install(source, { ...f.options, name: "external" })).succes).toBe(false);
  f.write(join(f.root, "theme.jsonc"), "{}");
  expect((await Luna.theme.install(f.root, { ...f.options, name: "recursive" })).succes).toBe(
    false,
  );
});

test("theme-relative wallpapers import without selecting, recursing or overwriting conflicts", async () => {
  const source = f.source("images", '{"wallpaper":{"sources":["wallpapers"]}}');
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>';
  f.write(join(source, "wallpapers/sample.svg"), svg);
  f.write(join(source, "wallpapers/nested/ignored.svg"), svg);
  f.write(join(source, "wallpapers/README.md"), "Not a wallpaper");
  data(await Luna.theme.install(source, f.options));
  expect(f.read(join(f.wallpaperDir, "sample.svg"))).toBe(svg);
  expect(existsSync(join(f.wallpaperDir, "ignored.svg"))).toBe(false);
  expect(existsSync(join(f.wallpaperDir, "README.md"))).toBe(false);
  expect(data(await Luna.theme.current(f.options))).toBeNull();
  f.write(join(f.wallpaperDir, "sample.svg"), "personal");
  expect((await Luna.theme.install(source, { ...f.options, force: true })).succes).toBe(false);
  expect(f.read(join(f.wallpaperDir, "sample.svg"))).toBe("personal");
  data(await Luna.theme.remove(["images"], f.options));
  expect(existsSync(join(f.wallpaperDir, "sample.svg"))).toBe(true);
  const explicit = f.source("unsupported", '{"wallpaper":{"sources":["README.md"]}}');
  f.write(join(explicit, "README.md"), "Not a wallpaper");
  expect(await Luna.theme.install(explicit, f.options)).toMatchObject({
    succes: false,
    err: "INVALID_METADATA",
  });
});

test("selection and T3 writes preserve private symlink target modes", async () => {
  const target = join(f.root, "private-selection.jsonc");
  f.write(target, "{}\n");
  chmodSync(target, 0o600);
  f.write(f.configFile, "{}\n");
  unlinkSync(f.configFile);
  symlinkSync(target, f.configFile);
  data(await Luna.theme.mode("light", f.options));
  expect(lstatSync(f.configFile).isSymbolicLink()).toBe(true);
  expect(statSync(target).mode & 0o777).toBe(0o600);
  const userdata = join(f.root, "t3");
  const client = join(f.root, "private-client.json");
  f.write(client, '{"personal":true}');
  chmodSync(client, 0o600);
  f.write(join(userdata, "settings.json"), "{}");
  symlinkSync(client, join(userdata, "client-settings.json"));
  data(await Luna.theme.applyT3code({ ...f.options, userdata }));
  expect(statSync(client).mode & 0o777).toBe(0o600);
  expect(JSON.parse(f.read(client)).personal).toBe(true);
});

test("failed desktop application restores exact selection and preference", async () => {
  data(await Luna.theme.install(f.source("custom"), f.options));
  const original = '// retain on failure\n{"theme":{}}\n';
  f.write(f.configFile, original);
  const options = { ...f.options, env: { ...f.env, THEME_FAIL_ONCE: "1" } };
  expect(await Luna.theme.set("custom", options)).toMatchObject({
    succes: false,
    err: "COMMAND_FAILED",
  });
  expect(f.read(f.configFile)).toBe(original);
  expect(f.read(f.env.THEME_PREFERENCE!)).toBe("default");
});

test("failed application preserves external edits and mode changes", async () => {
  data(await Luna.theme.install(f.source("custom"), f.options));
  const external = '// external writer\n{"theme":{"mode":"light"}}\n';
  const options = {
    ...f.options,
    env: {
      ...f.env,
      THEME_FAIL_ONCE: "1",
      THEME_EXTERNAL_EDIT: external,
      THEME_EXTERNAL_MODE: "prefer-light",
    },
  };
  expect(await Luna.theme.set("custom", options)).toMatchObject({
    succes: false,
    err: "COMMAND_FAILED",
  });
  expect(f.read(f.configFile)).toBe(external);
  expect(f.read(f.env.THEME_PREFERENCE!)).toBe("prefer-light");
});

test("concurrent writers are rejected by the selection lock", async () => {
  await locked(themeContext(f.options), async () => {
    expect(await Luna.theme.install(f.source("custom"), f.options)).toMatchObject({
      succes: false,
      err: "CONFLICT",
    });
  });
  expect((await Luna.theme.install(f.source("custom"), f.options)).succes).toBe(true);
});

test("T3 apply retains unrelated preferences, is idempotent, and rejects malformed settings before writes", async () => {
  const directory = join(f.root, "t3");
  f.write(join(directory, "client-settings.json"), '{"existing":true}');
  f.write(join(directory, "settings.json"), '{"other":"keep"}');
  const result = data(await Luna.theme.applyT3code({ ...f.options, userdata: directory }));
  const client = JSON.parse(f.read(result.client_settings));
  expect(client).toMatchObject({
    existing: true,
    fontFamilyCode: "Iosevka Nerd Font",
    mathRenderingEnabled: true,
  });
  const before = f.read(result.server_settings);
  data(await Luna.theme.applyT3code({ ...f.options, userdata: directory }));
  expect(f.read(result.server_settings)).toBe(before);
  f.write(result.client_settings, "[]");
  expect((await Luna.theme.applyT3code({ ...f.options, userdata: directory })).succes).toBe(false);
  expect(f.read(result.server_settings)).toBe(before);
});

test("theme dependencies allow only Pacman/AUR and install missing fonts before publication and selection", async () => {
  f.env.SELF_INSTALLED_JSON = join(f.root, "installed.json");
  const source = f.source(
    "fonts",
    JSON.stringify({
      packages: [
        { name: "font-official", source: "pacman" },
        { name: "font-aur", source: "aur" },
      ],
    }),
  );
  data(await Luna.theme.install(source, f.options));
  const commands = f
    .read(f.env.SELF_LOG!)
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(commands.filter((c) => c.args[0] === "-S").map((c) => [c.name, c.args.at(-1)])).toEqual([
    ["pacman", "font-official"],
    ["yay", "font-aur"],
  ]);
  const before = commands.length;
  data(await Luna.theme.set("fonts", f.options));
  expect(
    f
      .read(f.env.SELF_LOG!)
      .trim()
      .split("\n")
      .slice(before)
      .map((line) => JSON.parse(line))
      .every((c) => c.args[0] === "-Qq"),
  ).toBe(true);
  const invalid = f.source("invalid-fonts", '{"packages":[{"name":"font","source":"mise"}]}');
  expect(await Luna.theme.install(invalid, f.options)).toMatchObject({
    succes: false,
    err: "INVALID_METADATA",
  });
  const broken = f.source("broken-fonts", '{"packages":[{"name":"broken","source":"aur"}]}');
  expect(
    await Luna.theme.install(broken, { ...f.options, env: { ...f.env, SELF_FAIL: "yay:-S" } }),
  ).toMatchObject({ succes: false, err: "COMMAND_FAILED" });
  expect(existsSync(join(f.libraryDir, "broken-fonts"))).toBe(false);
  expect(data(await Luna.theme.current(f.options))).toBe("fonts");
});

test("already installed theme fonts do not require Yay or sudo", async () => {
  unlinkSync(join(f.bin, "yay"));
  unlinkSync(join(f.bin, "sudo"));
  const source = f.source(
    "installed-fonts",
    '{"packages":[{"name":"font-official","source":"pacman"},{"name":"font-aur","source":"aur"}]}',
  );
  data(await Luna.theme.install(source, f.options));
  data(await Luna.theme.set("installed-fonts", f.options));
  const commands = f
    .read(f.env.SELF_LOG!)
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(commands).toHaveLength(4);
  expect(commands.every((c) => c.name === "pacman" && c.args[0] === "-Qq")).toBe(true);
});

test.skipIf(!Bun.which("gsettings") || !Bun.which("dbus-run-session"))(
  "headless theme selection persists through real dconf without touching desktop settings",
  async () => {
    unlinkSync(join(f.bin, "gsettings"));
    symlinkSync(Bun.which("gsettings")!, join(f.bin, "gsettings"));
    const env = {
      HOME: f.home,
      PATH: `${f.bin}:/usr/bin:/bin`,
      XDG_CONFIG_HOME: join(f.home, ".config"),
      XDG_DATA_HOME: join(f.home, ".local/share"),
      XDG_CACHE_HOME: join(f.home, ".cache"),
      GSETTINGS_BACKEND: "dconf",
    };
    const options = { ...f.options, env };
    data(await Luna.theme.install(f.source("headless"), options));
    data(await Luna.theme.set("headless", options));
    expect(data(await Luna.theme.mode(undefined, options))).toBe("dark");
    data(await Luna.theme.mode("light", options));
    expect(data(await Luna.theme.mode(undefined, options))).toBe("light");
    expect(existsSync(join(env.XDG_CONFIG_HOME, "dconf/user"))).toBe(true);
  },
);
