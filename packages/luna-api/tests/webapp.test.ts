import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, symlinkSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { Luna, type ApiResponse } from "../src/index.ts";
import { AppFixture } from "./fixtures/app-fixture.ts";

let f: AppFixture;
beforeEach(() => {
  f = new AppFixture();
  f.browser();
});
afterEach(() => f.dispose());
const options = () => ({ env: f.env });
function data<T>(r: ApiResponse<T>): T {
  if (!r.succes) throw new Error(r.errMessage);
  return r.data;
}

test("web apps create isolated launchers, update URLs and uninstall without removing browser or unrelated data", async () => {
  const preferences = join(f.home, ".config/chromium/Luna/Preferences");
  f.write(f.home, ".local/share/applications/other.desktop", "keep");
  const app = data(
    await Luna.webapp.install(
      'My "App" 100% $name',
      "https://example.test/path?q=one&x=two",
      options(),
    ),
  );
  const entry = readFileSync(app.desktopFile, "utf8");
  expect(entry).toContain("Type=Application");
  expect(entry).toContain('"webapp" "launch"');
  expect(entry).toContain("100%%");
  expect(readFileSync(preferences, "utf8")).toBe("{}");
  expect(existsSync(f.env.CHROME_LOG!)).toBe(false);
  data(await Luna.webapp.install(app.name, "https://changed.test/", options()));
  expect(data(await Luna.webapp.list(options()))).toEqual([
    { id: app.id, name: app.name, url: "https://changed.test/" },
  ]);
  data(await Luna.webapp.uninstall(app.name, options()));
  expect(data(await Luna.webapp.list(options()))).toEqual([]);
  expect(existsSync(app.desktopFile)).toBe(false);
  expect(readFileSync(preferences, "utf8")).toBe("{}");
  expect(readFileSync(join(f.home, ".local/share/applications/other.desktop"), "utf8")).toBe(
    "keep",
  );
  data(await Luna.webapp.install(app.name, "https://again.test", options()));
  expect(data(await Luna.webapp.list(options()))).toHaveLength(1);
});

test("launch passes URL and name as data to Chromium app mode in the configured Luna profile", async () => {
  const url = "https://example.test/path?q=$(touch%20bad)&quotes=%22hello%22";
  const app = data(await Luna.webapp.install("Launch test", url, options()));
  const launched = data(await Luna.webapp.launch(app.name, options()));
  expect(launched.pid).toBeGreaterThan(0);
  const deadline = Date.now() + 2000;
  while (!existsSync(f.env.CHROME_LOG!) && Date.now() < deadline) await Bun.sleep(10);
  expect(JSON.parse(readFileSync(f.env.CHROME_LOG!, "utf8"))).toEqual([
    `--user-data-dir=${join(f.home, ".config/chromium")}`,
    "--profile-directory=Luna",
    `--app=${url}`,
    `--class=${app.id}`,
    "--no-first-run",
    "--no-default-browser-check",
  ]);
});

test("display names resembling IDs remain distinct and Unicode IDs fit filesystem limits", async () => {
  const first = data(await Luna.webapp.install("First", "https://example.test", options()));
  const second = data(await Luna.webapp.install(first.id, "https://second.test", options()));
  data(await Luna.webapp.install("界".repeat(30), "https://unicode.test", options()));
  data(await Luna.webapp.uninstall(first.id, options()));
  expect(data(await Luna.webapp.list(options())).map((app) => app.id)).toContain(first.id);
  expect(data(await Luna.webapp.list(options())).map((app) => app.id)).not.toContain(second.id);
});

test.each([
  "file:///etc/passwd",
  "javascript:alert(1)",
  "https://user:password@example.test",
  "https://example.test/\nBad",
])("invalid URL %s fails before launcher writes", async (url) => {
  expect(await Luna.webapp.install("Invalid", url, options())).toMatchObject({ succes: false });
  expect(existsSync(join(f.home, ".local/share/luna/webapps"))).toBe(false);
});

test("missing profile and unsafe exports fail without changing browser data", async () => {
  unlinkSync(join(f.home, ".config/chromium/Luna/Preferences"));
  expect(await Luna.webapp.install("Missing", "https://example.test", options())).toMatchObject({
    succes: false,
    err: "INVALID_PATH",
  });
  f.browser();
  f.write(f.root, "outside/sentinel", "keep");
  mkdirSync(join(f.home, ".local/share"), { recursive: true });
  symlinkSync(join(f.root, "outside"), join(f.home, ".local/share/applications"));
  expect(await Luna.webapp.install("Linked", "https://example.test", options())).toMatchObject({
    succes: false,
    err: "INVALID_PATH",
  });
  expect(readFileSync(join(f.root, "outside/sentinel"), "utf8")).toBe("keep");
  expect(
    await Luna.webapp.install("Overlap", "https://example.test", {
      ...options(),
      dataDir: join(f.home, ".config/chromium/Luna"),
    }),
  ).toMatchObject({ succes: false, err: "INVALID_PATH" });
});

test("CLI web app JSON requires missing fields without prompts and exposes install/list/uninstall", async () => {
  const entry = resolve(import.meta.dir, "../../../src/luna-cli/src/index.ts");
  const cli = async (args: string[]) => {
    const child = Bun.spawn([process.execPath, entry, "--json", "webapp", ...args], {
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
    expect(stderr).toBe("");
    return { code, value: JSON.parse(stdout) };
  };
  expect(await cli(["install"])).toMatchObject({
    code: 1,
    value: { succes: false, err: "INPUT_REQUIRED" },
  });
  expect(await cli(["install", "CLI App", "https://example.test"])).toMatchObject({
    code: 0,
    value: { succes: true },
  });
  expect((await cli(["list"])).value.data).toHaveLength(1);
  expect(await cli(["uninstall", "CLI App"])).toMatchObject({ code: 0, value: { succes: true } });
});

test("interactive CLI asks only for missing web app fields", async () => {
  const entry = resolve(import.meta.dir, "../../../src/luna-cli/src/index.ts");
  let output = "";
  let replied = false;
  const child = Bun.spawn([process.execPath, entry, "webapp", "install", "Prompted App"], {
    env: f.env,
    terminal: {
      data(terminal, bytes) {
        output += new TextDecoder().decode(bytes);
        if (!replied && output.includes("Web app URL:")) {
          replied = true;
          terminal.write("https://example.test/\n");
        }
      },
    },
  });
  const timer = setTimeout(() => child.kill(), 4000);
  try {
    expect(await child.exited, output).toBe(0);
    expect(replied).toBe(true);
    expect(output).not.toContain("Web app name:");
    expect(data(await Luna.webapp.list(options())).map((app) => app.name)).toEqual([
      "Prompted App",
    ]);
  } finally {
    clearTimeout(timer);
    child.kill();
    child.terminal?.close();
  }
});

test("profile symlink aliases cannot hide overlap with web app exports", async () => {
  const alias = join(f.root, "profile-alias");
  symlinkSync(join(f.home, ".local"), alias);
  expect(
    await Luna.webapp.install("Alias", "https://example.test", {
      ...options(),
      profileRoot: alias,
    }),
  ).toMatchObject({ succes: false, err: "INVALID_PATH" });
  expect(existsSync(join(f.home, ".local/share/luna/webapps"))).toBe(false);
});

test.skipIf(!Bun.which("gio"))(
  "desktop launch retains explicit API roots and browser outside the install environment",
  async () => {
    const entry = resolve(import.meta.dir, "../../../src/luna-cli/src/index.ts");
    const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";
    const launcher = join(f.home, "custom bin/luna % cli");
    f.write(
      f.home,
      "custom bin/luna % cli",
      `#!${Bun.which("bash")}\nexec ${[process.execPath, entry].map(quote).join(" ")} "$@"\n`,
    );
    const { chmodSync } = await import("node:fs");
    chmodSync(launcher, 0o755);
    const profileRoot = join(f.root, "custom profile");
    f.write(profileRoot, "Luna/Preferences", "{}");
    const custom = {
      ...options(),
      launcher,
      profileRoot,
      dataDir: join(f.root, "custom data"),
      applicationsDir: join(f.root, "custom applications"),
      chromium: join(f.bin, "chromium"),
    };
    const app = data(
      await Luna.webapp.install(
        'Custom "App" 100% $name `value` \\',
        "https://example.test/",
        custom,
      ),
    );
    const child = Bun.spawn([Bun.which("gio")!, "launch", app.desktopFile], {
      env: { ...f.env, PATH: "/usr/bin:/bin" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(status, stdout + stderr).toBe(0);
    const deadline = Date.now() + 2000;
    while (!existsSync(f.env.CHROME_LOG!) && Date.now() < deadline) await Bun.sleep(10);
    const args = JSON.parse(readFileSync(f.env.CHROME_LOG!, "utf8"));
    expect(args).toContain(`--user-data-dir=${profileRoot}`);
    expect(args).toContain("--app=https://example.test/");
    expect(existsSync(join(f.home, ".local/share/luna/webapps"))).toBe(false);
  },
);
