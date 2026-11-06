import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { Luna, type ApiResponse } from "../src/index.ts";
import { AppFixture } from "./fixtures/app-fixture.ts";

let f: AppFixture;
let server: ReturnType<typeof Bun.serve>;
let routes: Map<string, () => Response>;
let requests: string[];
beforeEach(() => {
  f = new AppFixture();
  f.browser();
  routes = new Map();
  requests = [];
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      requests.push(path);
      return routes.get(path)?.() ?? new Response("Missing", { status: 404 });
    },
  });
});
afterEach(() => {
  server.stop(true);
  f.dispose();
});
function data<T>(response: ApiResponse<T>): T {
  if (!response.succes) throw new Error(response.errMessage);
  return response.data;
}
function serve(path: string, body: string | Buffer, headers: Record<string, string> = {}) {
  routes.set(
    path,
    () => new Response(typeof body === "string" ? body : new Uint8Array(body), { headers }),
  );
}
async function png(size: number) {
  const pixel = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5x8AAAAASUVORK5CYII=",
    "base64",
  );
  return Buffer.from(await new Bun.Image(pixel).resize(size, size).png().buffer());
}
const install = async (path = "/", options = {}) =>
  data(
    await Luna.webapp.install("Website", new URL(path, server.url).href, {
      env: f.env,
      ...options,
    }),
  );
const appDirectory = (id: string) => join(f.home, ".local/share/luna/webapps", id);
function desktopIcon(path: string) {
  return `Icon=${path.replaceAll("\\", "\\\\").replaceAll(" ", "\\s")}\n`;
}

test("uses the largest original image from redirected page and manifest URLs, including undeclared sizes", async () => {
  const small = await png(32);
  const large = await png(1024);
  routes.set("/start", () => Response.redirect(new URL("/app/page", server.url)));
  serve(
    "/app/page",
    `<base href="/assets/"><link REL="shortcut ICON" href="small.png">
    <link rel="manifest" href="site.webmanifest">`,
  );
  serve("/assets/small.png", small);
  routes.set("/assets/site.webmanifest", () =>
    Response.redirect(new URL("/manifest/app.json", server.url)),
  );
  serve(
    "/manifest/app.json",
    JSON.stringify({
      icons: [
        null,
        { src: 42 },
        { src: "small.png", sizes: "4096x4096" },
        { src: "large.png" },
        { src: "mask.png", purpose: "monochrome" },
      ],
    }),
  );
  serve("/manifest/small.png", small);
  serve("/manifest/large.png", large, { "content-type": "application/octet-stream" });
  const app = await install("/start");
  const icon = join(appDirectory(app.id), "icon.png");
  expect(readFileSync(app.desktopFile, "utf8")).toContain(desktopIcon(icon));
  expect(readFileSync(icon)).toEqual(large);
  expect(requests).not.toContain("/manifest/mask.png");
  expect(existsSync(f.env.CHROME_LOG!)).toBe(false);
  expect(readFileSync(join(f.home, ".config/chromium/Luna/Preferences"), "utf8")).toBe("{}");
  data(await Luna.webapp.uninstall(app.name, { env: f.env }));
  expect(existsSync(icon)).toBe(false);
  expect(existsSync(app.desktopFile)).toBe(false);
});

test("prefers scalable SVG and replaces icons on reinstall without touching unrelated files", async () => {
  const svg =
    '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M0 0h20v20z"/></svg>';
  serve("/", '<link rel="apple-touch-icon" href="/large.png"><link rel="icon" href="/logo.svg">');
  serve("/large.png", await png(1024));
  serve("/logo.svg", svg);
  const app = await install();
  const directory = appDirectory(app.id);
  const icon = join(directory, "icon.svg");
  expect(readFileSync(icon, "utf8")).toBe(svg);
  expect(readFileSync(app.desktopFile, "utf8")).toContain(desktopIcon(icon));
  f.write(directory, "unrelated", "keep");
  serve("/", '<link rel="apple-touch-icon" href="/large.png">');
  await install();
  expect(existsSync(icon)).toBe(false);
  expect(existsSync(join(directory, "icon.png"))).toBe(true);
  routes.clear();
  await install();
  expect(existsSync(join(directory, "icon.png"))).toBe(false);
  expect(readFileSync(app.desktopFile, "utf8")).toContain("Icon=applications-internet\n");
  data(await Luna.webapp.uninstall(app.name, { env: f.env }));
  expect(readFileSync(join(directory, "unrelated"), "utf8")).toBe("keep");
});

test("falls back from invalid icons and a broken manifest to the touch icon", async () => {
  const bytes = await png(180);
  serve(
    "/",
    `<link rel="manifest" href="/broken.json">
    <link rel="icon" href="/fake.png" sizes="any">
    <link rel="apple-touch-icon-precomposed" href="/touch.png">`,
  );
  serve("/broken.json", "{broken");
  serve("/fake.png", "<html>Sign in</html>", { "content-type": "image/png" });
  serve("/touch.png", bytes);
  const app = await install();
  expect(readFileSync(join(appDirectory(app.id), "icon.png"))).toEqual(bytes);
});

test("downloads the original conventional ICO when page retrieval fails", async () => {
  const pngBytes = await png(256);
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(pngBytes.length, 14);
  header.writeUInt32LE(22, 18);
  const ico = Buffer.concat([header, pngBytes]);
  serve("/favicon.ico", ico);
  const app = await install();
  const icon = join(appDirectory(app.id), "icon.ico");
  expect(readFileSync(icon)).toEqual(ico);
  expect(readFileSync(app.desktopFile, "utf8")).toContain(desktopIcon(icon));
});

test("rejects unsafe URLs, redirect targets, oversized bodies and HTML disguised as icons", async () => {
  serve(
    "/",
    `<link rel="icon" href="file:///etc/passwd">
    <link rel="icon" href="http://user:password@127.0.0.1/private">
    <link rel="icon" href="/redirect"><link rel="icon" href="/oversized">
    <link rel="icon" href="/stream"><link rel="icon" href="/html">`,
  );
  routes.set(
    "/redirect",
    () => new Response(null, { status: 302, headers: { location: "file:///etc/passwd" } }),
  );
  serve("/oversized", "small", { "content-length": String(9 * 1024 * 1024) });
  serve("/stream", Buffer.alloc(8 * 1024 * 1024 + 1));
  serve("/html", "<html>Not an icon</html>", { "content-type": "image/png" });
  const app = await install();
  expect(readFileSync(app.desktopFile, "utf8")).toContain("Icon=applications-internet\n");
  expect(requests).not.toContain("/private");
});

test("a stalled icon stream times out without blocking installation", async () => {
  serve("/", '<link rel="icon" href="/stalled">');
  routes.set(
    "/stalled",
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
          },
        }),
      ),
  );
  const started = Date.now();
  const app = await install();
  expect(Date.now() - started).toBeLessThan(7500);
  expect(readFileSync(app.desktopFile, "utf8")).toContain("Icon=applications-internet\n");
}, 10000);

test("uses a manifest's maskable icon when it is the available site logo", async () => {
  const bytes = await png(512);
  serve("/", '<link rel="manifest" href="/app.json">');
  serve("/app.json", JSON.stringify({ icons: [{ src: "/maskable.png", purpose: "maskable" }] }));
  serve("/maskable.png", bytes);
  const app = await install();
  expect(readFileSync(join(appDirectory(app.id), "icon.png"))).toEqual(bytes);
});

test("icon exports reject symlinks before changing launch metadata or external files", async () => {
  serve("/", '<link rel="icon" href="/icon.png">');
  serve("/icon.png", await png(64));
  const app = await install();
  const icon = join(appDirectory(app.id), "icon.svg");
  f.write(f.root, "outside.svg", "keep");
  const external = join(f.root, "outside.svg");
  symlinkSync(external, icon);
  const entry = readFileSync(app.desktopFile, "utf8");
  expect(await Luna.webapp.install(app.name, server.url.href, { env: f.env })).toMatchObject({
    succes: false,
    err: "INVALID_PATH",
  });
  expect(await Luna.webapp.uninstall(app.name, { env: f.env })).toMatchObject({
    succes: false,
    err: "INVALID_PATH",
  });
  expect(readFileSync(app.desktopFile, "utf8")).toBe(entry);
  expect(readFileSync(external, "utf8")).toBe("keep");
});

test("escapes spaces in custom icon paths for desktop entries", async () => {
  serve("/", '<link rel="icon" href="/icon.png">');
  serve("/icon.png", await png(64));
  const root = join(f.root, "custom data/icons");
  const app = await install("/", { dataDir: root });
  const icon = join(root, app.id, "icon.png");
  expect(existsSync(icon)).toBe(true);
  expect(readFileSync(app.desktopFile, "utf8")).toContain(desktopIcon(icon));
});
