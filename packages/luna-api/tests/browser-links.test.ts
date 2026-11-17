import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { routeBrowserLink, browserLinkConfigSchema } from "../src/modules/webapp/browser-links.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "luna-links-"));
  roots.push(home);
  const dataDir = join(home, "webapps");
  const id = `luna-webapp-${Buffer.from("WhatsApp").toString("hex")}`;
  await mkdir(join(dataDir, id), { recursive: true });
  await Bun.write(
    join(dataDir, id, "app.jsonc"),
    JSON.stringify({ id, name: "WhatsApp", url: "https://web.whatsapp.com/" }),
  );
  const config = browserLinkConfigSchema.parse({
    dataDir,
    profileRoot: join(home, "chromium"),
    extensionId: "a".repeat(32),
    extraOrigins: ["https://accounts.google.com/"],
  });
  return {
    home,
    config,
    env: {
      HOME: home,
      PATH: "/usr/bin",
      CHROME_USER_DATA_DIR: config.profileRoot,
      BROWSER: "chromium",
    },
  };
}

test("registered and login origins stay in Luna without opening another browser", async () => {
  const f = await fixture();
  for (const url of ["https://web.whatsapp.com/chat", "https://accounts.google.com/login"]) {
    const result = await routeBrowserLink({
      ...f,
      request: { type: "open", url },
      run: async () => {
        throw new Error("Must not spawn");
      },
    });
    expect(result.opened).toBe(false);
    expect(result.origins).toContain("https://web.whatsapp.com");
  }
});

test("external URL remains a literal argument and profile overrides do not escape", async () => {
  const f = await fixture();
  const calls: string[][] = [];
  const url = "https://example.com/?value=$(touch%20/tmp/no)&q=`id`#section";
  const result = await routeBrowserLink({
    ...f,
    request: { type: "open", url },
    run: async (args, env) => {
      calls.push(args);
      expect(env).not.toHaveProperty("BROWSER");
      expect(env).not.toHaveProperty("CHROME_USER_DATA_DIR");
      return args[0] === "xdg-mime" ? "zen.desktop" : "";
    },
  });
  expect(result.opened).toBe(true);
  expect(calls).toEqual([
    ["xdg-mime", "query", "default", "x-scheme-handler/https"],
    ["gio", "open", new URL(url).href],
  ]);
});

test("unsafe schemes, credentials, loops and helper failures are reported", async () => {
  const f = await fixture();
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://user:password@example.com/",
    "--help",
  ])
    await expect(routeBrowserLink({ ...f, request: { type: "open", url } })).rejects.toThrow();
  await expect(
    routeBrowserLink({
      ...f,
      request: { type: "open", url: "https://example.com/" },
      run: async () => "chromium.desktop",
    }),
  ).rejects.toThrow("default browser");
  await expect(
    routeBrowserLink({
      ...f,
      request: { type: "open", url: "https://example.com/" },
      run: async (args) => {
        if (args[0] === "xdg-mime") return "zen.desktop";
        throw new Error("Cannot open default browser");
      },
    }),
  ).rejects.toThrow("Cannot open");
});
