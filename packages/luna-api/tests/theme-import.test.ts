import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { Luna, type ApiResponse } from "../src/index.ts";
import { themeRemote } from "../src/modules/theme/lib/remote.ts";
import { ThemeFixture } from "./fixtures/theme-fixture.ts";
import { WallpaperFixture } from "./fixtures/wallpaper-fixture.ts";

let f: ThemeFixture;
beforeEach(() => {
  f = new ThemeFixture();
});
afterEach(() => {
  f.dispose();
});
function data<T>(response: ApiResponse<T>): T {
  if (!response.succes) throw new Error(response.errMessage);
  return response.data;
}
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>';

test.each(["json", "jsonc"])(
  "standalone %s keeps authored bytes, suggests a filename, and imports relative media",
  async (extension) => {
    const file = join(f.root, `My Night.${extension}`);
    const source =
      '// authored colors\n{"colors":{"accent":"#123456"},"wallpaper":{"sources":["images/night.svg"]}}\n';
    f.write(file, source);
    f.write(join(f.root, "images/night.svg"), svg);
    const info = data(await Luna.theme.info(file, f.options));
    expect(info).toMatchObject({
      suggestedName: "my-night",
      needsName: false,
      remote: false,
      wallpapers: ["images/night.svg"],
    });
    expect(existsSync(f.libraryDir)).toBe(false);
    const installed = data(
      await Luna.theme.install(file, { ...f.options, fingerprint: info.fingerprint }),
    );
    expect(f.read(join(installed, `theme.${extension}`))).toBe(source);
    expect(f.read(join(f.wallpaperDir, "night.svg"))).toBe(svg);
    expect(data(await Luna.theme.list(f.options))).toEqual([{ name: "my-night", current: false }]);
  },
);

test("generic filenames require an explicit name and reviewed sources cannot change before installation", async () => {
  const file = join(f.root, "config.jsonc");
  f.write(file, "{}");
  const info = data(await Luna.theme.info(file, f.options));
  expect(info.needsName).toBe(true);
  expect(info.suggestedName).toBe("config");
  expect(await Luna.theme.install(file, f.options)).toMatchObject({
    succes: false,
    err: "INPUT_REQUIRED",
  });
  f.write(file, '{"colors":{"mode":"light"}}');
  expect(
    await Luna.theme.install(file, { ...f.options, name: "custom", fingerprint: info.fingerprint }),
  ).toMatchObject({ succes: false, err: "CONFLICT" });
  expect(existsSync(join(f.libraryDir, "custom"))).toBe(false);
  data(await Luna.theme.install(file, { ...f.options, name: "custom" }));
});

test("folders support JSON and reject ambiguous manifests", async () => {
  f.write(join(f.root, "json-folder/theme.json"), "{}");
  data(await Luna.theme.install(join(f.root, "json-folder"), f.options));
  f.write(join(f.root, "json-folder/theme.jsonc"), "{}");
  expect(await Luna.theme.info(join(f.root, "json-folder"), f.options)).toMatchObject({
    succes: false,
    err: "INVALID_METADATA",
  });
});

test("raw HTTP JSONC info has no asset/package side effects; install downloads declared files", async () => {
  const requests: string[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      const path = new URL(request.url).pathname;
      requests.push(path);
      if (path === "/night.jsonc")
        return new Response(
          '{"wallpaper":{"sources":["night.svg"]},"packages":[{"name":"font-test","source":"pacman"}]}',
        );
      if (path === "/night.svg") return new Response(svg);
      return new Response("missing", { status: 404 });
    },
  });
  f.env.SELF_INSTALLED_JSON = join(f.root, "installed.json");
  try {
    const source = `${server.url}night.jsonc`;
    const info = data(await Luna.theme.info(source, f.options));
    expect(info.packages).toEqual([{ name: "font-test", source: "pacman", installed: false }]);
    expect(requests).toEqual(["/night.jsonc"]);
    expect(existsSync(f.wallpaperDir)).toBe(false);
    expect(f.read(f.env.SELF_LOG!)).not.toContain('"-S"');
    data(await Luna.theme.install(source, { ...f.options, fingerprint: info.fingerprint }));
    expect(requests).toEqual(["/night.jsonc", "/night.jsonc", "/night.svg"]);
    expect(f.read(join(f.wallpaperDir, "night.svg"))).toBe(svg);
    expect(f.read(f.env.SELF_LOG!)).toContain('"-S"');
  } finally {
    await server.stop(true);
  }
});

test("GitHub folders and raw files inspect pinned metadata, then stage only that folder", async () => {
  let revision = "a".repeat(40);
  const downloads: string[] = [];
  const text = spyOn(themeRemote, "text").mockImplementation(async (url) => {
    if (url.includes("/commits/")) return JSON.stringify({ sha: revision });
    if (url.includes("/git/trees/"))
      return JSON.stringify({
        truncated: false,
        tree: [
          { path: "themes/night/theme.jsonc", type: "blob", mode: "100644", sha: "b".repeat(40) },
          {
            path: "themes/night/wallpapers/night.svg",
            type: "blob",
            mode: "100644",
            sha: "c".repeat(40),
            size: svg.length,
          },
          { path: "themes/night/notes.txt", type: "blob", mode: "100644", sha: "f".repeat(40) },
          { path: "unrelated/other.jpg", type: "blob", mode: "100644", sha: "d".repeat(40) },
        ],
      });
    return '{"wallpaper":{"sources":["wallpapers"]}}';
  });
  const download = spyOn(themeRemote, "download").mockImplementation(async ({ url, path }) => {
    downloads.push(url);
    await Bun.write(path, svg);
  });
  try {
    const source = "https://github.com/owner/repository/tree/main/themes/night";
    const info = data(await Luna.theme.info(source, f.options));
    expect(info.suggestedName).toBe("night");
    expect(info.files.map((file) => file.path)).toEqual([
      "theme.jsonc",
      "wallpapers/night.svg",
      "notes.txt",
    ]);
    expect(downloads).toEqual([]);
    revision = "e".repeat(40);
    expect(
      await Luna.theme.install(source, { ...f.options, fingerprint: info.fingerprint }),
    ).toMatchObject({ succes: false, err: "CONFLICT" });
    expect(downloads).toEqual([]);
    revision = "a".repeat(40);
    data(await Luna.theme.install(source, { ...f.options, fingerprint: info.fingerprint }));
    expect(downloads).toEqual([
      `https://raw.githubusercontent.com/owner/repository/${revision}/themes/night/wallpapers/night.svg`,
      `https://raw.githubusercontent.com/owner/repository/${revision}/themes/night/notes.txt`,
    ]);
    const raw = data(
      await Luna.theme.info(
        "https://raw.githubusercontent.com/owner/repository/main/themes/night/theme.jsonc",
        f.options,
      ),
    );
    expect(raw).toMatchObject({ needsName: true, suggestedName: "theme" });
    expect(raw.files.map((file) => file.path)).toEqual(["theme.jsonc", "wallpapers/night.svg"]);
    expect(
      (
        await Luna.theme.info(
          "https://raw.githubusercontent.com/owner/repository/refs/heads/main/themes/night/theme.jsonc",
          f.options,
        )
      ).succes,
    ).toBe(true);
    data(
      await Luna.theme.install(
        "https://github.com/owner/repository/blob/main/themes/night/theme.jsonc",
        { ...f.options, name: "raw" },
      ),
    );
  } finally {
    text.mockRestore();
    download.mockRestore();
  }
});

test("remote traversal, unsupported URLs and local asset symlinks cannot escape", async () => {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch() {
      return new Response('{"wallpaper":{"sources":["../escape.svg"]}}');
    },
  });
  try {
    expect(await Luna.theme.info(`${server.url}night.json`, f.options)).toMatchObject({
      succes: false,
      err: "INVALID_PATH",
    });
    expect((await Luna.theme.info("ftp://example.com/theme.json", f.options)).succes).toBe(false);
    expect(
      (await Luna.theme.info("https://user:secret@example.com/theme.json", f.options)).succes,
    ).toBe(false);
    const file = join(f.root, "theme.json");
    f.write(file, '{"wallpaper":{"sources":["escape.svg"]}}');
    const outside = join(f.root, "../outside.svg");
    symlinkSync("/etc/passwd", join(f.root, "escape.svg"));
    expect((await Luna.theme.install(file, { ...f.options, name: "escaping" })).succes).toBe(false);
    expect(existsSync(outside)).toBe(false);
  } finally {
    await server.stop(true);
  }
});

test("theme activation selects bundled wallpaper and fonts, and failed rendering recovers theme selection", async () => {
  const renderer = new WallpaperFixture();
  Object.assign(f.env, renderer.env, { PATH: `${f.bin}:${renderer.bin}` });
  const options = { ...f.options, wallpaperConfigFile: renderer.configFile };
  try {
    const theme = f.source(
      "night",
      '{"fonts":{"ui":"Example UI","mono":"Example Mono"},"wallpaper":{"sources":["night.svg"]}}',
    );
    f.write(join(theme, "night.svg"), svg);
    data(await Luna.theme.install(theme, options));
    data(await Luna.theme.set("night", options));
    const wallpaperOptions = { ...renderer.options, env: f.env, libraryDir: f.wallpaperDir };
    expect(data(await Luna.wallpaper.current(wallpaperOptions))).toBe(
      join(f.wallpaperDir, "night.svg"),
    );
    const gtk = f.read(join(renderer.root, ".local/share/themes/Luna/gtk-3.0/gtk.css"));
    expect(gtk).toContain('font-family: "Example UI"');
    expect(gtk).toContain('font-family: "Example Mono"');
    data(await Luna.wallpaper.start(wallpaperOptions));
    const bad = f.source("broken", '{"wallpaper":{"sources":["broken.svg"]}}');
    f.write(join(bad, "broken.svg"), svg);
    data(await Luna.theme.install(bad, options));
    const previous = f.read(f.configFile);
    f.env.LUNA_TEST_REJECT = "1";
    expect((await Luna.theme.set("broken", options)).succes).toBe(false);
    expect(f.read(f.configFile)).toBe(previous);
    expect(data(await Luna.wallpaper.current(wallpaperOptions))).toBe(
      join(f.wallpaperDir, "night.svg"),
    );
  } finally {
    renderer.dispose();
  }
});

test("shuffle uses the same activation and avoids the current theme", async () => {
  expect((await Luna.theme.random(f.options)).succes).toBe(false);
  for (const name of ["one", "two"]) data(await Luna.theme.install(f.source(name), f.options));
  data(await Luna.theme.set("one", f.options));
  expect(data(await Luna.theme.random(f.options)).name).toBe("two");
  expect(data(await Luna.theme.current(f.options))).toBe("two");
});

test("activation reuses downloaded URL wallpapers and restores missing media", async () => {
  const renderer = new WallpaperFixture();
  Object.assign(f.env, renderer.env, { PATH: `${f.bin}:${renderer.bin}` });
  symlinkSync(Bun.which("curl")!, join(f.bin, "curl"));
  let downloads = 0;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch() {
      downloads++;
      return new Response(svg);
    },
  });
  const options = { ...f.options, wallpaperConfigFile: renderer.configFile };
  try {
    const source = f.source(
      "remote-media",
      JSON.stringify({ wallpaper: { sources: [`${server.url}night.svg`] } }),
    );
    data(await Luna.theme.install(source, options));
    expect(downloads).toBe(1);
    data(await Luna.theme.set("remote-media", options));
    expect(downloads).toBe(1);
    const { unlink } = await import("node:fs/promises");
    await unlink(join(f.wallpaperDir, "night.svg"));
    data(await Luna.theme.set("remote-media", options));
    expect(downloads).toBe(2);
  } finally {
    await server.stop(true);
    renderer.dispose();
  }
});

test("desktop package installation uses Polkit and configures Yay's elevation for that invocation", async () => {
  const authLog = join(f.root, "auth.json");
  f.env.LUNA_TEST_AUTH_LOG = authLog;
  f.env.SELF_INSTALLED_JSON = join(f.root, "installed.json");
  f.write(
    join(f.bin, "pkexec"),
    `#!${process.execPath}\nimport {writeFileSync} from 'node:fs';\nwriteFileSync(Bun.env.LUNA_TEST_AUTH_LOG, JSON.stringify(Bun.argv.slice(2)));\nconst child = Bun.spawn(Bun.argv.slice(2), {env: Bun.env, stdout: 'inherit', stderr: 'inherit'});\nprocess.exit(await child.exited);\n`,
  );
  const { chmod } = await import("node:fs/promises");
  await chmod(join(f.bin, "pkexec"), 0o755);
  const source = f.source(
    "desktop-auth",
    JSON.stringify({
      packages: [
        { name: "official-font", source: "pacman" },
        { name: "aur-font", source: "aur" },
      ],
    }),
  );
  data(await Luna.theme.install(source, { ...f.options, authorization: "polkit" }));
  expect(JSON.parse(f.read(authLog))).toEqual([
    "pacman",
    "-S",
    "--needed",
    "--noconfirm",
    "--",
    "official-font",
  ]);
  const yay = f
    .read(f.env.SELF_LOG!)
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .find((command) => command.name === "yay");
  expect(yay.args).toEqual([
    "-S",
    "--needed",
    "--noconfirm",
    "--sudo",
    "pkexec",
    "--sudoflags",
    "",
    "--nosudoloop",
    "--",
    "aur-font",
  ]);
});
