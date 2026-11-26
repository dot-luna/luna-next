import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { buildLogin } from "../src/modules/login/build.ts";
import { loginSettingsSchema } from "../src/modules/login/schema.ts";

const sourceDirectory = new URL("../../../src/luna-login/src", import.meta.url).pathname;
let root: string;
let configFile: string;
let output: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "luna-login-config-"));
  configFile = join(root, "config.jsonc");
  output = join(root, "theme");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const build = () => buildLogin({ configFile, sourceDirectory, output });
async function snapshot() {
  const source = await Bun.file(join(output, "Settings.js")).text();
  return JSON.parse(
    source
      .slice(source.indexOf("var values = ") + 13)
      .trim()
      .replace(/;$/, ""),
  );
}

test("missing config uses standalone defaults without writing them into its source", async () => {
  await build();
  expect(Bun.JSONC.parse(await Bun.file(configFile).text())).toEqual({});
  const settings = await snapshot();
  expect(settings.login.user).toBeNull();
  expect(settings.actions.shutdown_delay).toBe(3);
  expect(settings.theme.colors.accent).toBe("#7aa2f7");
  expect(settings.background.path).toBe("");
});

test("bundles relative screen and image paths while preserving authored settings", async () => {
  await mkdir(join(root, "custom"));
  const screen = "import QtQuick\nItem {}\n";
  await Bun.write(join(root, "custom/Screen.qml"), screen);
  await Bun.write(
    join(root, "image.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7xkAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const config = `// Keep this comment and partial overrides.\n{
    "screen":{"path":"./custom"}, "background":{"path":"./image.png"},
    "theme":{"colors":{"accent":"#123456"},"appearance":{"rounding":18,"blur":{"enabled":false}}},
    "actions":{"shutdown_delay":0}, "login":{"user":"alice"}
  }`;
  await Bun.write(configFile, config);
  await build();
  const settings = await snapshot();
  expect(settings.screen.path).toBe("screen");
  expect(settings.background.path).toBe("assets/background.png");
  expect(settings.theme.appearance).toEqual({
    rounding: 18,
    blur: { enabled: false, size: 10, passes: 3 },
  });
  expect(settings.theme.colors.accent).toBe("#123456");
  expect(settings.theme.colors.error).toBe("#f7768e");
  expect(settings.actions.shutdown_delay).toBe(0);
  expect(settings.login.user).toBe("alice");
  expect(await Bun.file(configFile).text()).toBe(config);
  expect(await Bun.file(join(root, "custom/Screen.qml")).text()).toBe(screen);
  expect(await Bun.file(join(output, "screen/Screen.qml")).text()).toBe(screen);
  expect(await Bun.file(join(output, settings.background.path)).exists()).toBe(true);
});

test("replaces only the output and keeps the previous bundle after invalid input", async () => {
  await build();
  await Bun.write(join(root, "untouched"), "outside output");
  await Bun.write(join(output, "obsolete"), "old asset");
  await build();
  expect(await Bun.file(join(output, "obsolete")).exists()).toBe(false);
  expect(await Bun.file(join(root, "untouched")).text()).toBe("outside output");
  const previous = await Bun.file(join(output, "Settings.js")).text();
  await Bun.write(join(root, "video.jpg"), "not an image");
  await Bun.write(configFile, JSON.stringify({ background: { path: "./video.jpg" } }));
  await expect(build()).rejects.toThrow("Only image backgrounds");
  expect(await Bun.file(join(output, "Settings.js")).text()).toBe(previous);
});

test("rejects source overlap, linked outputs, and screen links escaping their root", async () => {
  await Bun.write(configFile, "{}");
  await expect(
    buildLogin({ configFile, sourceDirectory, output: sourceDirectory }),
  ).rejects.toThrow();
  await mkdir(join(root, "outside"));
  await symlink(join(root, "outside"), output);
  await expect(build()).rejects.toThrow();
  await rm(output);
  await mkdir(join(root, "custom"));
  await Bun.write(join(root, "custom/Screen.qml"), "import QtQuick\nItem {}\n");
  await symlink(join(root, "outside"), join(root, "custom/escape"));
  await Bun.write(configFile, JSON.stringify({ screen: { path: "./custom" } }));
  await expect(build()).rejects.toThrow();
});

test("example config is valid and unsupported settings fail validation", async () => {
  const example = new URL("../../../src/luna-login/config.example.jsonc", import.meta.url);
  expect(
    loginSettingsSchema.safeParse(Bun.JSONC.parse(await Bun.file(example).text())).success,
  ).toBe(true);
  for (const value of [
    { actions: { shutdown_delay: -1 } },
    { actions: { shutdown_delay: 1.5 } },
    { actions: { shutdown_delay: 2_147_483_648 } },
    { actions: { shutdown_delay: "3" } },
    { login: { session: "plasma.desktop" } },
    { login: { user: "" } },
    { background: { type: "video" } },
    { screen: { name: "default" } },
    { theme: { colors: { accent: "#fff" } } },
    { theme: { fonts: { ui: "  " } } },
    { theme: { appearance: { rounding: 101 } } },
    { theme: { appearance: { blur: { passes: 11 } } } },
  ])
    expect(loginSettingsSchema.safeParse(value).success).toBe(false);
});
