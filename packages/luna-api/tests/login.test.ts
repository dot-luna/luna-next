import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "pathe";
import { loginBuilder } from "../src/modules/login/build.ts";
import { loginSettingsSchema } from "../src/modules/login/schema.ts";
import { Luna, type LoginOptions } from "../src/index.ts";
import { loginTemplate } from "../src/modules/login/template.ts";

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

const build = () => loginBuilder.build({ configFile, sourceDirectory, output });
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
  expect(settings.login.user).toBe("jrtilak");
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
    loginBuilder.build({ configFile, sourceDirectory, output: sourceDirectory }),
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

function apiOptions(): LoginOptions {
  return {
    configFile,
    repository: new URL("../../../", import.meta.url).pathname,
    systemRoot: join(root, "system"),
    env: { PATH: "/usr/bin:/bin", HOME: join(root, "home") },
  };
}

async function write(path: string, value: string | Uint8Array) {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, value);
}
function nativeConfig() {
  return join(root, "system/etc/sddm.conf");
}
async function failCommand(name: string, body = "process.exit(7)") {
  const binary = join(root, "bin", name);
  await write(binary, `#!${process.execPath}\n${body}\n`);
  await chmod(binary, 0o755);
  const options = apiOptions();
  options.env!.PATH = join(root, "bin") + ":/usr/bin:/bin";
  return options;
}

test("API installs atomically, preserves native SDDM settings, and uninstalls only its own files", async () => {
  const options = apiOptions();
  const file = nativeConfig();
  const native =
    "# Personal SDDM settings\n[Theme]\nCurrent=breeze\nThemeDir=/custom/themes\n[X11]\nEnableHiDPI=true\n";
  await write(file, native);
  expect(await Luna.login.status(options)).toMatchObject({
    succes: true,
    data: { installed: false, selected: false },
  });
  expect(await Luna.login.install(options)).toMatchObject({
    succes: true,
    data: { installed: true, selected: true },
  });
  const theme = join(root, "system/usr/share/sddm/themes/luna");
  await write(join(theme, "obsolete"), "old asset");
  await write(join(root, "system/usr/share/sddm/themes/other/Main.qml"), "keep");
  expect((await stat(join(theme, "Settings.js"))).mode & 0o444).toBe(0o444);
  expect(await Luna.login.install(options)).toMatchObject({ succes: true });
  expect(await Bun.file(join(theme, "obsolete")).exists()).toBe(false);
  expect((await Bun.file(file).text()).split("# BEGIN LUNA LOGIN")).toHaveLength(2);
  expect(await Luna.login.uninstall(options)).toMatchObject({
    succes: true,
    data: { installed: false, selected: false },
  });
  expect(await Bun.file(file).text()).toBe(native);
  expect(await Bun.file(join(root, "system/usr/share/sddm/themes/other/Main.qml")).text()).toBe(
    "keep",
  );
  expect(await Luna.login.uninstall(options)).toMatchObject({ succes: true });
});

test("status follows SDDM config precedence and refresh preserves another selected theme", async () => {
  const options = apiOptions();
  expect(await Luna.login.install(options)).toMatchObject({ succes: true });
  const file = nativeConfig();
  await write(file, "# Native override\n[Theme]\nCurrent=other\n");
  expect(await Luna.login.status(options)).toMatchObject({
    succes: true,
    data: { installed: true, selected: false },
  });
  expect(
    await Luna.login.updateConfig({ theme: { appearance: { rounding: 12 } } }, options),
  ).toMatchObject({ succes: true });
  expect(await Bun.file(file).text()).toBe("# Native override\n[Theme]\nCurrent=other\n");
  expect(await Luna.login.status(options)).toMatchObject({
    succes: true,
    data: { selected: false },
  });
  await write(
    join(root, "system/usr/lib/sddm/sddm.conf.d/default.conf"),
    "[Theme]\nCurrent=other\n",
  );
  await write(
    join(root, "system/etc/sddm.conf.d/20-theme.conf"),
    "[Theme]\nCurrent=luna # inline comment\n",
  );
  await write(file, "[General]\nNumlock=on\n");
  expect(await Luna.login.status(options)).toMatchObject({
    succes: true,
    data: { selected: true },
  });
});

test("nested configuration patches retain tokens and failed deployment restores the exact source", async () => {
  const options = apiOptions();
  await write(
    configFile,
    '// Personal source\n{"theme":{"colors":{"accent":"#123456"},"appearance":{"blur":{"size":12,"passes":2}}},"login":{"user":"alice"}}\n',
  );
  expect(await Luna.login.install(options)).toMatchObject({ succes: true });
  const updated = await Luna.login.updateConfig(
    { theme: { appearance: { blur: { enabled: false } } } },
    options,
  );
  expect(updated).toMatchObject({
    succes: true,
    data: {
      theme: {
        colors: { accent: "#123456" },
        appearance: { blur: { size: 12, passes: 2, enabled: false } },
      },
      login: { user: "alice" },
    },
  });
  const original = await Bun.file(configFile).text();
  const previousTheme = await Bun.file(
    join(root, "system/usr/share/sddm/themes/luna/Settings.js"),
  ).text();
  const failure = await Luna.login.updateConfig(
    { login: { user: "sam" } },
    await failCommand("cp"),
  );
  expect(failure).toMatchObject({ succes: false });
  expect(await Bun.file(configFile).text()).toBe(original);
  expect(await Bun.file(join(root, "system/usr/share/sddm/themes/luna/Settings.js")).text()).toBe(
    previousTheme,
  );
  expect(await Luna.login.getConfig("missing", options)).toEqual({ succes: true, data: null });
});

test("failed native config publication rolls back the exchanged theme", async () => {
  const options = apiOptions();
  expect(await Luna.login.install(options)).toMatchObject({ succes: true });
  const theme = join(root, "system/usr/share/sddm/themes/luna/Settings.js");
  const previous = await Bun.file(theme).text();
  await write(nativeConfig(), "[Theme]\nCurrent=other\n");
  await write(configFile, '{"theme":{"colors":{"accent":"#112233"}}}');
  expect(await Luna.login.install(await failCommand("install"))).toMatchObject({ succes: false });
  expect(await Bun.file(theme).text()).toBe(previous);
  expect(await Bun.file(nativeConfig()).text()).toBe("[Theme]\nCurrent=other\n");
});

test("external edits survive failed configuration application", async () => {
  const options = apiOptions();
  expect(await Luna.login.install(options)).toMatchObject({ succes: true });
  const external = '{"login":{"user":"external"}}\n';
  const broken = await failCommand(
    "cp",
    `await Bun.write(${JSON.stringify(configFile)},${JSON.stringify(external)});process.exit(7)`,
  );
  expect(await Luna.login.updateConfig({ login: { user: "alice" } }, broken)).toMatchObject({
    succes: false,
    err: "CONFLICT",
  });
  expect(await Bun.file(configFile).text()).toBe(external);
});

test("wallpaper replaces one managed image and --login leaves the desktop config untouched", async () => {
  const options = apiOptions();
  const image = join(root, "first.png");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7xkAAAAASUVORK5CYII=",
    "base64",
  );
  await write(image, png);
  const desktop = join(root, "desktop.jsonc");
  await write(desktop, '// Desktop stays unchanged\n{"wallpaper":{"source":"/desktop.png"}}\n');
  const original = await Bun.file(desktop).text();
  expect(await Luna.login.install(options)).toMatchObject({ succes: true });
  const selected = await Luna.wallpaper.set(image, {
    ...options,
    configFile: desktop,
    login: true,
    loginConfigFile: configFile,
  });
  expect(selected).toMatchObject({ succes: true });
  if (!selected.succes || !("background" in selected.data))
    throw new Error("Expected Login settings");
  const managed = (selected.data.background as { path: string }).path;
  await rm(image);
  expect(Buffer.from(await Bun.file(managed).arrayBuffer())).toEqual(png);
  const second = join(root, "second.png");
  const changed = Buffer.concat([png, Buffer.from("updated image")]);
  await write(second, changed);
  expect(await Luna.login.setWallpaper(second, options)).toMatchObject({
    succes: true,
    data: { background: { path: managed } },
  });
  expect(Buffer.from(await Bun.file(managed).arrayBuffer())).toEqual(changed);
  expect(await Bun.file(desktop).text()).toBe(original);
  expect(
    await Bun.file(join(root, "system/usr/share/sddm/themes/luna/assets/background")).exists(),
  ).toBe(true);
  const config = await Bun.file(configFile).text();
  expect(await Luna.login.setWallpaper(second, await failCommand("cp"))).toMatchObject({
    succes: false,
  });
  expect(await Bun.file(configFile).text()).toBe(config);
  expect(Buffer.from(await Bun.file(managed).arrayBuffer())).toEqual(changed);
  await write(join(root, "video.mp4"), "video");
  expect(await Luna.login.setWallpaper(join(root, "video.mp4"), options)).toMatchObject({
    succes: false,
  });
});

test("preview uses an isolated test-mode bundle and removes it on exit", async () => {
  const options = await failCommand(
    "sddm-greeter-qt6",
    `const args=Bun.argv.slice(2);await Bun.write(${JSON.stringify(join(root, "preview.json"))},JSON.stringify({args,settings:await Bun.file(args[2]+"/Settings.js").text()}));`,
  );
  expect(await Luna.login.preview(options)).toMatchObject({ succes: true });
  const preview = await Bun.file(join(root, "preview.json")).json();
  expect(preview.args.slice(0, 2)).toEqual(["--test-mode", "--theme"]);
  expect(await Bun.file(preview.args[2] + "/Main.qml").exists()).toBe(false);
  expect(await Luna.login.status(options)).toMatchObject({
    succes: true,
    data: { installed: false, selected: false },
  });
});

test("unknown themes, malformed activation blocks, and linked system paths are refused", async () => {
  const options = apiOptions();
  await write(join(root, "system/usr/share/sddm/themes/luna/Main.qml"), "foreign theme");
  expect(await Luna.login.install(options)).toMatchObject({ succes: false, err: "CONFLICT" });
  expect(await Luna.login.uninstall(options)).toMatchObject({ succes: false, err: "CONFLICT" });
  await rm(join(root, "system/usr/share/sddm/themes/luna"), { recursive: true });
  await write(nativeConfig(), "# BEGIN LUNA LOGIN\n[Theme]\nCurrent=changed\n");
  expect(await Luna.login.install(options)).toMatchObject({ succes: false, err: "CONFLICT" });
  await rm(join(root, "system/etc"), { recursive: true });
  await mkdir(join(root, "outside"));
  await symlink(join(root, "outside"), join(root, "system/etc"));
  expect(await Luna.login.install(options)).toMatchObject({ succes: false });
  expect(await Bun.file(join(root, "outside/sddm.conf")).exists()).toBe(false);
});

test("installation template snapshots theme tokens and its first image, with jrtilak selected by default", async () => {
  const options = apiOptions();
  const home = options.env!.HOME!;
  const theme = join(home, ".local/share/luna/themes/custom");
  await write(join(home, ".config/luna/theme.jsonc"), '{"theme":{"name":"custom"}}');
  const authored =
    '// authored theme\n{"colors":{"accent":"#112233"},"fonts":{"ui":"serif"},"appearance":{"rounding":18,"blur":{"enabled":false}},"wallpaper":{"sources":["wallpapers"]}}\n';
  await write(join(theme, "theme.jsonc"), authored);
  await write(join(theme, "wallpapers/00-video.mp4"), "video");
  const background = join(theme, "wallpapers/01-image.svg");
  await write(
    background,
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>',
  );
  const settings = await loginTemplate.resolve({ template: {}, env: options.env });
  expect(settings).toMatchObject({
    theme: {
      colors: { accent: "#112233" },
      fonts: { ui: "serif" },
      appearance: { rounding: 18, blur: { enabled: false } },
    },
    background: { path: background },
    login: { user: "jrtilak" },
  });
  expect(await Bun.file(join(theme, "theme.jsonc")).text()).toBe(authored);
  await write(configFile, JSON.stringify(settings));
  expect(await Luna.login.install(options)).toMatchObject({ succes: true });
  expect(
    await Bun.file(join(root, "system/usr/share/sddm/themes/luna/assets/background.svg")).text(),
  ).toContain("<svg");
  const explicit = await loginTemplate.resolve({
    template: {
      theme: { colors: { accent: "#445566" } },
      background: { path: "/explicit.png" },
      login: { user: null },
    },
    env: options.env,
  });
  expect(explicit).toMatchObject({
    theme: { colors: { accent: "#445566" } },
    background: { path: "/explicit.png" },
    login: { user: null },
  });
});

test("explicit null still selects the first user instead of the jrtilak default", async () => {
  await Bun.write(configFile, '{"login":{"user":null}}');
  await build();
  expect((await snapshot()).login.user).toBeNull();
});
