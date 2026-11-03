import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  installMedia,
  libraryDirectory,
  listMedia,
  managedPath,
  validateMedia,
  type LibraryContext,
} from "../src/wallpaper/library.ts";
import { importWallpapers } from "../src/theme/wallpapers.ts";
import { themeContext } from "../src/theme/context.ts";
import { locked } from "../src/lib/files.ts";

const svg = (color = "red") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="${color}"/></svg>`;
let root: string;
let context: LibraryContext;
let server: ReturnType<typeof Bun.serve> | undefined;

function write(path: string, contents = svg()) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  return path;
}
function names() {
  return readdirSync(context.libraryDir).filter((name) => !name.startsWith("."));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "luna media ' "));
  context = { libraryDir: join(root, "library"), env: { PATH: Bun.env.PATH! } };
});
afterEach(() => {
  server?.stop(true);
  server = undefined;
  rmSync(root, { recursive: true, force: true });
});

test("files use content validation, preserve names and sources, and install idempotently", async () => {
  const source = write(join(root, "a ' # ? $(image).svg"));
  expect(await validateMedia(context, source)).toBe("image/svg+xml");
  const path = join(context.libraryDir, "a ' # ? $(image).svg");
  expect(await installMedia(context, [source])).toEqual([path]);
  expect(await installMedia(context, [source])).toEqual([path]);
  expect(readFileSync(source, "utf8")).toBe(svg());
  expect(readFileSync(path, "utf8")).toBe(svg());
  expect(await managedPath(context, "a ' # ? $(image).svg")).toBe(path);
  expect(await listMedia(context)).toEqual([{ name: "a ' # ? $(image).svg", path }]);
  expect(readdirSync(context.libraryDir)).toEqual(["a ' # ? $(image).svg"]);
});

test("video containers are accepted independently of filename extensions", async () => {
  const source = join(root, "video-without-extension");
  // A minimal ISO media header exercises MIME detection; decoding belongs to the renderer.
  const contents = Buffer.from("000000186674797069736f6d0000020069736f6d69736f32", "hex");
  writeFileSync(source, contents);
  expect(await validateMedia(context, source)).toBe("video/mp4");
  expect(await installMedia(context, [source])).toEqual([
    join(context.libraryDir, "video-without-extension"),
  ]);
  expect(readFileSync(join(context.libraryDir, "video-without-extension"))).toEqual(contents);
});

test("folders skip unrelated files and links, and recursion flattens nested media", async () => {
  const directory = join(root, "sources");
  write(join(directory, "top.svg"));
  write(join(directory, "notes.png"), "plain text with a misleading extension");
  write(join(directory, "nested/deep.svg"), svg("blue"));
  symlinkSync(join(directory, "top.svg"), join(directory, "file-link.svg"));
  symlinkSync(join(directory, "nested"), join(directory, "folder-link"));
  expect(await installMedia(context, [directory])).toEqual([join(context.libraryDir, "top.svg")]);
  expect(names()).toEqual(["top.svg"]);
  expect(await installMedia(context, [directory], { recursive: true })).toEqual([
    join(context.libraryDir, "deep.svg"),
    join(context.libraryDir, "top.svg"),
  ]);
  expect((await listMedia(context)).map((entry) => entry.name)).toEqual(["deep.svg", "top.svg"]);
});

test("the complete batch validates before publishing explicit unsupported files or conflicts", async () => {
  const valid = write(join(root, "first.svg"));
  const invalid = write(join(root, "last.png"), "not media");
  await expect(installMedia(context, [valid, invalid])).rejects.toMatchObject({
    code: "INVALID_METADATA",
  });
  expect(names()).toEqual([]);
  const existing = write(join(context.libraryDir, "last.svg"), svg("green"));
  const conflicting = write(join(root, "last.svg"), svg("blue"));
  await expect(installMedia(context, [valid, conflicting])).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(names()).toEqual(["last.svg"]);
  expect(readFileSync(existing, "utf8")).toBe(svg("green"));
});

test("duplicate basenames coalesce identical bytes and reject differing nested files before publish", async () => {
  const source = join(root, "sources");
  write(join(source, "a/same.svg"));
  write(join(source, "b/same.svg"));
  expect(await installMedia(context, [source], { recursive: true })).toEqual([
    join(context.libraryDir, "same.svg"),
  ]);
  rmSync(context.libraryDir, { recursive: true });
  write(join(source, "b/same.svg"), svg("blue"));
  await expect(installMedia(context, [source], { recursive: true })).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(names()).toEqual([]);
});

test("one explicit file can be named; folders, multiple inputs and unsafe names are refused", async () => {
  const source = write(join(root, "source.svg"));
  expect(await installMedia(context, [source], { name: "personal name.svg" })).toEqual([
    join(context.libraryDir, "personal name.svg"),
  ]);
  for (const name of [
    "",
    " ",
    ".",
    "..",
    "../outside.svg",
    "/absolute.svg",
    "a/b.svg",
    "a\\b.svg",
    "bad\n.svg",
    ".library.lock",
    ".luna-media-owned",
  ])
    await expect(installMedia(context, [source], { name })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  await expect(installMedia(context, [source, source], { name: "one.svg" })).rejects.toMatchObject({
    code: "INVALID_ARGUMENT",
  });
  const directory = join(root, "folder");
  mkdirSync(directory);
  await expect(installMedia(context, [directory], { name: "one.svg" })).rejects.toMatchObject({
    code: "INVALID_ARGUMENT",
  });
  await expect(installMedia(context, [])).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
});

test("HTTP sources support redirects, encoded filenames and deterministic unnamed downloads", async () => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/redirect") return Response.redirect(new URL("/scene.svg", request.url));
      return new Response(svg(), { headers: { "Content-Type": "image/svg+xml" } });
    },
  });
  const url = server.url.href;
  const installed = await installMedia(context, [url + "my%20scene.svg", url + "redirect", url]);
  expect(installed[0]).toBe(join(context.libraryDir, "my scene.svg"));
  expect(installed[1]).toBe(join(context.libraryDir, "redirect"));
  expect(installed[2]).toMatch(/\/wallpaper-[0-9a-f]{16}\.svg$/u);
  expect(await installMedia(context, [url])).toEqual([installed[2]!]);
  expect(await installMedia(context, [url], { name: "renamed.svg" })).toEqual([
    join(context.libraryDir, "renamed.svg"),
  ]);
  for (const path of installed) expect(readFileSync(path, "utf8")).toBe(svg());
});

test("failed URLs leave the batch unpublished and credentials, controls and unsafe decoded names are rejected", async () => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/loop") return Response.redirect(request.url);
      if (path === "/file") return Response.redirect("file:///etc/passwd");
      return new Response("missing", { status: 404 });
    },
  });
  const source = write(join(root, "valid.svg"));
  for (const endpoint of ["missing", "loop", "file"])
    await expect(
      installMedia(context, [source, new URL(endpoint, server.url).href]),
    ).rejects.toMatchObject({ code: "COMMAND_FAILED" });
  expect(names()).toEqual([]);
  for (const url of [
    "https://user:password@example.com/a.svg",
    "ftp://example.com/a.svg",
    "https://example.com/a\n.svg",
    "https://example.com/bad%00.svg",
    "https://example.com/%2Fescape.svg",
    "https://example.com/%ZZ",
  ])
    await expect(installMedia(context, [url])).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  expect(names()).toEqual([]);
});

test("managed paths and listings exclude reserved files, links, directories and unrelated content", async () => {
  expect(await listMedia(context)).toEqual([]);
  write(join(context.libraryDir, "z.svg"));
  write(join(context.libraryDir, "a.svg"));
  write(join(context.libraryDir, ".library.lock"));
  write(join(context.libraryDir, ".luna-owned.svg"));
  write(join(context.libraryDir, "notes"), "not media");
  write(join(context.libraryDir, "nested/file.svg"));
  symlinkSync(join(context.libraryDir, "z.svg"), join(context.libraryDir, "linked.svg"));
  expect((await listMedia(context)).map((entry) => entry.name)).toEqual(["a.svg", "z.svg"]);
  for (const name of ["../z.svg", ".library.lock", ".luna-owned.svg"])
    await expect(managedPath(context, name)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  for (const name of ["linked.svg", "nested", "missing.svg"])
    await expect(managedPath(context, name)).rejects.toMatchObject({ code: "INVALID_PATH" });
});

test("linked libraries, non-directory parents and source/library overlap fail without touching destinations", async () => {
  const source = write(join(root, "source.svg"));
  const outside = join(root, "outside");
  mkdirSync(outside);
  symlinkSync(outside, context.libraryDir);
  await expect(installMedia(context, [source])).rejects.toMatchObject({ code: "INVALID_PATH" });
  expect(readdirSync(outside)).toEqual([]);
  rmSync(context.libraryDir);
  const linkedParent = join(root, "linked-parent");
  symlinkSync(outside, linkedParent);
  await expect(
    libraryDirectory({ ...context, libraryDir: join(linkedParent, "child") }, true),
  ).rejects.toMatchObject({ code: "INVALID_PATH" });
  const fileParent = write(join(root, "not-directory"), "content");
  await expect(
    libraryDirectory({ ...context, libraryDir: join(fileParent, "child") }, true),
  ).rejects.toMatchObject({ code: "INVALID_PATH" });
  await expect(installMedia(context, [root], { recursive: true })).rejects.toMatchObject({
    code: "INVALID_PATH",
  });
  write(join(context.libraryDir, "existing.svg"));
  await expect(
    installMedia(context, [context.libraryDir], { recursive: true }),
  ).rejects.toMatchObject({ code: "INVALID_PATH" });
  await expect(
    installMedia(context, [join(context.libraryDir, "existing.svg")]),
  ).rejects.toMatchObject({ code: "INVALID_PATH" });
  symlinkSync(join(context.libraryDir, "existing.svg"), join(root, "alias.svg"));
  await expect(installMedia(context, [join(root, "alias.svg")])).rejects.toMatchObject({
    code: "INVALID_PATH",
  });
  expect(names()).toEqual(["existing.svg"]);
});

test("a symlink destination cannot be overwritten even with matching content", async () => {
  const source = write(join(root, "same.svg"));
  mkdirSync(context.libraryDir);
  symlinkSync(source, join(context.libraryDir, "same.svg"));
  await expect(installMedia(context, [source])).rejects.toMatchObject({ code: "CONFLICT" });
  expect(readFileSync(source, "utf8")).toBe(svg());
});

test("media commands honor an explicitly empty caller PATH", async () => {
  const source = write(join(root, "source.svg"));
  await expect(installMedia({ ...context, env: { PATH: "" } }, [source])).rejects.toMatchObject({
    code: "COMMAND_FAILED",
  });
  expect(names()).toEqual([]);
});

test("theme imports confine their sources and share the wallpaper library lock", async () => {
  const source = join(root, "theme");
  const inside = write(join(source, "image.svg"));
  const outside = write(join(root, "outside.svg"));
  const theme = themeContext({
    env: { ...context.env, HOME: root },
    wallpaperDir: context.libraryDir,
  });
  symlinkSync(outside, join(source, "escape.svg"));
  await expect(importWallpapers(theme, source, ["escape.svg"])).rejects.toMatchObject({
    code: "INVALID_PATH",
  });
  await expect(importWallpapers(theme, source, [outside])).rejects.toMatchObject({
    code: "INVALID_PATH",
  });
  await libraryDirectory(context, true);
  await locked({ env: context.env, configFile: join(context.libraryDir, ".library") }, async () => {
    await expect(importWallpapers(theme, source, ["image.svg"])).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
  await importWallpapers(theme, source, ["image.svg"]);
  expect(readFileSync(join(context.libraryDir, "image.svg"), "utf8")).toBe(
    readFileSync(inside, "utf8"),
  );
});
