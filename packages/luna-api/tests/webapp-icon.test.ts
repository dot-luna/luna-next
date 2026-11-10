import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join, relative } from "node:path";
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
  return `Icon=${path.replaceAll("\\", "\\\\")}\n`;
}

test("copies a relative local icon without discovery and retains it after the source is removed", async () => {
  const bytes = await png(128);
  const sourcePath = join(f.root, "custom icon.data");
  await Bun.write(sourcePath, bytes);
  const app = await install("/", { icon: relative(process.cwd(), sourcePath) });
  const installedIcon = join(appDirectory(app.id), "icon.png");
  rmSync(sourcePath);
  expect(readFileSync(installedIcon)).toEqual(bytes);
  expect(readFileSync(app.desktopFile, "utf8")).toContain(desktopIcon(installedIcon));
  expect(requests).toEqual([]);
  expect(data(await Luna.webapp.list({ env: f.env }))).toEqual([
    { name: app.name, url: app.url, id: app.id },
  ]);
});

test("downloads an explicit icon through redirects without visiting the app website", async () => {
  const bytes = await png(256);
  routes.set("/custom-icon", () => Response.redirect(new URL("/images/logo", server.url)));
  serve("/images/logo", bytes);
  const app = await install("/", { icon: new URL("/custom-icon", server.url).href });
  expect(readFileSync(join(appDirectory(app.id), "icon.png"))).toEqual(bytes);
  expect(requests).toEqual(["/custom-icon", "/images/logo"]);
});

test("invalid explicit icons preserve the installed metadata, launcher and icon", async () => {
  const originalBytes = await png(64);
  const sourcePath = join(f.root, "original.png");
  await Bun.write(sourcePath, originalBytes);
  const app = await install("/", { icon: sourcePath });
  const directory = appDirectory(app.id);
  const originalMetadata = readFileSync(join(directory, "app.jsonc"));
  const originalDesktopEntry = readFileSync(app.desktopFile);
  const invalidPath = join(f.root, "invalid.png");
  await Bun.write(invalidPath, "<html>Not an image</html>");
  serve("/invalid", "<html>Not an image</html>");
  serve("/too-large", Buffer.alloc(8 * 1024 * 1024 + 1));
  routes.set("/unsafe-redirect", () =>
    new Response(null, { status: 302, headers: { location: "file:///etc/passwd" } }),
  );
  for (const icon of [
    invalidPath,
    join(f.root, "missing.png"),
    f.root,
    new URL("/invalid", server.url).href,
    new URL("/missing", server.url).href,
    new URL("/too-large", server.url).href,
    new URL("/unsafe-redirect", server.url).href,
    "file:///etc/passwd",
    "https://user:password@example.test/icon.png",
    "",
  ]) {
    const result = await Luna.webapp.install(app.name, new URL("/changed", server.url).href, {
      env: f.env,
      icon,
    });
    expect(result.succes).toBe(false);
    expect(readFileSync(join(directory, "app.jsonc"))).toEqual(originalMetadata);
    expect(readFileSync(app.desktopFile)).toEqual(originalDesktopEntry);
    expect(readFileSync(join(directory, "icon.png"))).toEqual(originalBytes);
  }
  expect(requests).not.toContain("/changed");
  expect(requests).not.toContain("/favicon.ico");
});

test("rejects oversized local icons and replaces old formats when a custom icon changes", async () => {
  const sourcePath = join(f.root, "custom-icon");
  await Bun.write(sourcePath, Buffer.alloc(8 * 1024 * 1024 + 1));
  expect(await Luna.webapp.install("Website", server.url.href, { env: f.env, icon: sourcePath }))
    .toMatchObject({ succes: false, err: "INVALID_METADATA" });

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"/>';
  await Bun.write(sourcePath, svg);
  const app = await install("/", { icon: sourcePath });
  const directory = appDirectory(app.id);
  expect(readFileSync(join(directory, "icon.svg"), "utf8")).toBe(svg);
  const bytes = await png(128);
  await Bun.write(sourcePath, bytes);
  await install("/", { icon: sourcePath });
  expect(existsSync(join(directory, "icon.svg"))).toBe(false);
  expect(readFileSync(join(directory, "icon.png"))).toEqual(bytes);
  expect(readFileSync(sourcePath)).toEqual(bytes);
});

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

test("rejects malformed SVG instead of preferring it over a usable full-resolution PNG", async () => {
  const bytes = await png(512);
  serve("/", '<link rel="icon" href="/broken.svg"><link rel="icon" href="/logo.png">');
  serve("/broken.svg", "<svg>not an SVG document", { "content-type": "image/svg+xml" });
  serve("/logo.png", bytes);
  const app = await install();
  expect(readFileSync(join(appDirectory(app.id), "icon.png"))).toEqual(bytes);
  expect(existsSync(join(appDirectory(app.id), "icon.svg"))).toBe(false);
});

test("accepts a valid SVG with a standard DOCTYPE instead of choosing a smaller PNG", async () => {
  const svg =
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M0 0h20v20z"/></svg>';
  serve("/", '<link rel="icon" href="/logo.svg"><link rel="icon" href="/small.png">');
  serve("/logo.svg", svg);
  serve("/small.png", await png(32));
  const app = await install();
  expect(readFileSync(join(appDirectory(app.id), "icon.svg"), "utf8")).toBe(svg);
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

test("retains literal spaces in custom desktop icon paths", async () => {
  serve("/", '<link rel="icon" href="/icon.png">');
  serve("/icon.png", await png(64));
  const root = join(f.root, "custom data/icons");
  const app = await install("/", { dataDir: root });
  const icon = join(root, app.id, "icon.png");
  expect(existsSync(icon)).toBe(true);
  expect(readFileSync(app.desktopFile, "utf8")).toContain(desktopIcon(icon));
});

test.skipIf(!Bun.which("quickshell"))(
  "Quickshell resolves and displays the downloaded icon from a path with spaces",
  async () => {
    serve("/", '<link rel="icon" href="/icon.svg">');
    serve(
      "/icon.svg",
      '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><path fill="red" d="M0 0h512v512H0z"/></svg>',
    );
    const app = await install();
    const expected = join(appDirectory(app.id), "icon.svg");
    const shell = join(f.root, "icon-smoke.qml");
    f.write(
      f.root,
      "icon-smoke.qml",
      `import QtQuick
import Quickshell
ShellRoot {
  property Image icon: Image {
    onStatusChanged: {
      if (status === Image.Ready) { console.log("ICON_READY", sourceSize.width, sourceSize.height); Qt.quit(); }
      if (status === Image.Error) { console.log("ICON_ERROR"); Qt.quit(); }
    }
  }
  Timer {
    interval: 100; running: true; repeat: true
    onTriggered: {
      const app = DesktopEntries.applications.values.find(entry => entry.id === ${JSON.stringify(app.id)});
      if (!app) return;
      console.log("ICON_PATH_MATCH", app.icon === ${JSON.stringify(expected)});
      icon.source = "file://" + app.icon.split("/").map(encodeURIComponent).join("/");
      stop();
    }
  }
}`,
    );
    const runtime = join(f.root, "runtime");
    mkdirSync(runtime, { mode: 0o700 });
    const child = Bun.spawn([Bun.which("quickshell")!, "--path", shell], {
      env: {
        ...f.env,
        XDG_DATA_HOME: join(f.home, ".local/share"),
        XDG_RUNTIME_DIR: runtime,
        QT_QPA_PLATFORM: "offscreen",
        QT_QUICK_BACKEND: "software",
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => child.kill(), 5000);
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      const output = stdout + stderr;
      expect(code, output).toBe(0);
      expect(output).toContain("ICON_PATH_MATCH true");
      expect(output).toContain("ICON_READY 512 512");
    } finally {
      clearTimeout(timer);
      child.kill();
    }
  },
  10000,
);
