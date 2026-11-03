import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { Luna } from "../src/index.ts";
import { WallpaperFixture } from "./fixtures/wallpaper-fixture.ts";

let f: WallpaperFixture;
beforeEach(() => {
  f = new WallpaperFixture();
  symlinkSync(Bun.which("file")!, join(f.bin, "file"));
});
afterEach(() => f.dispose());

function media(name: string, color = "red") {
  const path = join(f.root, "downloads", name);
  f.write(
    path,
    `<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="${color}"/></svg>`,
  );
  return path;
}

test("wallpaper data paths use the same Luna and XDG roots as theme imports", async () => {
  expect(await Luna.wallpaper.path(undefined, f.options)).toEqual({
    succes: true,
    data: join(f.root, ".local/share/luna/wallpapers"),
  });
  expect(
    await Luna.wallpaper.path(undefined, {
      env: { ...f.env, XDG_DATA_HOME: join(f.root, "data") },
    }),
  ).toEqual({ succes: true, data: join(f.root, "data/luna/wallpapers") });
  expect(
    await Luna.wallpaper.path(undefined, {
      env: { ...f.env, LUNA_DATA_HOME_DIR: join(f.root, "luna-data") },
    }),
  ).toEqual({ succes: true, data: join(f.root, "luna-data/wallpapers") });
  expect(
    await Luna.wallpaper.path(undefined, { ...f.options, libraryDir: join(f.root, "explicit") }),
  ).toEqual({ succes: true, data: join(f.root, "explicit") });
  expect(await Luna.wallpaper.path(undefined, { ...f.options, libraryDir: "/" })).toMatchObject({
    succes: false,
    err: "INVALID_PATH",
  });
});

test("offline library operations keep source bytes intact and copies survive removal of originals", async () => {
  rmSync(f.shell, { recursive: true });
  rmSync(join(f.bin, "qs"));
  f.source('// authored settings\n{"wallpaper":{"fit":"fit"},}\n');
  const before = f.read();
  const original = media("blue sky.svg");
  const installed = join(f.root, ".local/share/luna/wallpapers/blue sky.svg");
  expect(await Luna.wallpaper.add(original, f.options)).toEqual({
    succes: true,
    data: [{ name: "blue sky.svg", path: installed, current: false }],
  });
  rmSync(original);
  expect(readFileSync(installed, "utf8")).toContain("<svg");
  expect(await Luna.wallpaper.list(f.options)).toEqual({
    succes: true,
    data: [{ name: "blue sky.svg", path: installed, current: false }],
  });
  expect(await Luna.wallpaper.path("blue sky.svg", f.options)).toEqual({
    succes: true,
    data: installed,
  });
  expect(await Luna.wallpaper.current(f.options)).toEqual({ succes: true, data: null });
  expect(f.read()).toBe(before);
  expect(await Luna.wallpaper.remove(["blue sky.svg"], { ...f.options, dryRun: true })).toEqual({
    succes: true,
    data: [installed],
  });
  expect(existsSync(installed)).toBe(true);
  expect(await Luna.wallpaper.remove(["blue sky.svg"], f.options)).toEqual({
    succes: true,
    data: [installed],
  });
  expect(existsSync(installed)).toBe(false);
  expect(f.commands()).toHaveLength(0);
});

test("installed names apply stable paths and failed selection restores settings and active media", async () => {
  const first = media("first.svg");
  const broken = media("broken.svg");
  expect((await Luna.wallpaper.install([first, broken], f.options)).succes).toBe(true);
  expect((await Luna.wallpaper.start(f.options)).succes).toBe(true);
  expect((await Luna.wallpaper.set("first.svg", f.options)).succes).toBe(true);
  const before = f.read();
  const path = join(f.root, ".local/share/luna/wallpapers/first.svg");
  expect(f.state().settings.wallpaper.source).toBe(path);
  expect(await Luna.wallpaper.current(f.options)).toEqual({ succes: true, data: path });
  expect(await Luna.wallpaper.set("broken.svg", f.options)).toMatchObject({
    succes: false,
    err: "COMMAND_FAILED",
  });
  expect(f.read()).toBe(before);
  expect(f.state().settings.wallpaper.source).toBe(path);
  expect(await Luna.wallpaper.list(f.options)).toMatchObject({
    succes: true,
    data: [
      { name: "broken.svg", current: false },
      { name: "first.svg", current: true },
    ],
  });
});

test("removal protects both saved and active media, validates batches, and never deletes external files", async () => {
  await Luna.wallpaper.install([media("first.svg"), media("other.svg")], f.options);
  await Luna.wallpaper.start(f.options);
  await Luna.wallpaper.set("first.svg", f.options);
  const first = join(f.root, ".local/share/luna/wallpapers/first.svg");
  expect(await Luna.wallpaper.remove(["other.svg", "first.svg"], f.options)).toMatchObject({
    succes: false,
    err: "INVALID_ARGUMENT",
  });
  expect(existsSync(join(f.root, ".local/share/luna/wallpapers/other.svg"))).toBe(true);
  f.source('{"wallpaper":{"source":""}}');
  expect(await Luna.wallpaper.remove(["first.svg"], f.options)).toMatchObject({
    succes: false,
    err: "INVALID_ARGUMENT",
  });
  await Luna.wallpaper.set("", f.options);
  expect(await Luna.wallpaper.remove(["first.svg", "missing.svg"], f.options)).toMatchObject({
    succes: false,
    err: "INVALID_PATH",
  });
  expect(existsSync(first)).toBe(true);
  const external = media("external.svg");
  expect(await Luna.wallpaper.remove([external], f.options)).toMatchObject({
    succes: false,
    err: "INVALID_ARGUMENT",
  });
  expect(existsSync(external)).toBe(true);
  const alias = join(f.root, "selected-link.svg");
  symlinkSync(first, alias);
  await Luna.wallpaper.set(alias, f.options);
  expect(await Luna.wallpaper.remove(["first.svg"], f.options)).toMatchObject({
    succes: false,
    err: "INVALID_ARGUMENT",
  });
});

test("library mutations share one lock, reject linked destinations and validate arguments before publication", async () => {
  const source = media("first.svg");
  const libraryDir = join(f.root, "library");
  const options = { ...f.options, libraryDir };
  f.write(join(libraryDir, ".keep"), "");
  const lock = Bun.spawn(
    [
      "flock",
      "--exclusive",
      join(libraryDir, ".library.lock"),
      "bash",
      "-c",
      'printf "locked\\n"; read -r',
    ],
    { env: f.env, stdin: "pipe", stdout: "pipe", stderr: "pipe" },
  );
  await lock.stdout.getReader().read();
  try {
    expect(await Luna.wallpaper.install(source, options)).toMatchObject({
      succes: false,
      err: "CONFLICT",
    });
    expect(existsSync(join(libraryDir, "first.svg"))).toBe(false);
  } finally {
    lock.stdin.write("done\n");
    lock.stdin.end();
    await lock.exited;
  }
  expect(
    await Luna.wallpaper.install(source, { ...options, recursive: "false" as unknown as boolean }),
  ).toMatchObject({ succes: false, err: "INVALID_ARGUMENT" });
  const linked = join(f.root, "linked");
  symlinkSync(libraryDir, linked);
  expect(await Luna.wallpaper.install(source, { ...options, libraryDir: linked })).toMatchObject({
    succes: false,
    err: "INVALID_PATH",
  });
  expect(existsSync(join(libraryDir, "first.svg"))).toBe(false);
});

test("invalid settings and conflicting library/config roots fail before publishing media", async () => {
  const source = media("first.svg");
  const libraryDir = join(f.root, "library");
  f.source("not JSONC");
  expect(await Luna.wallpaper.install(source, { ...f.options, libraryDir })).toMatchObject({
    succes: false,
    err: "INVALID_METADATA",
  });
  expect(existsSync(join(libraryDir, "first.svg"))).toBe(false);
  expect(
    await Luna.wallpaper.install(source, { ...f.options, libraryDir: f.configHome }),
  ).toMatchObject({ succes: false, err: "INVALID_PATH" });
});
