import { afterEach, expect, test } from "bun:test";
import { lstat, readlink } from "node:fs/promises";
import {
  appearance,
  currentTheme,
  extensionId,
  setupProfile,
  startBrowser,
  unpack,
  verifiedArchive,
  withDefaults,
} from "../../../apps/chromium/scripts/setup-profile.ts";

const roots: string[] = [];
const environment = { ...Bun.env };
const createScript = new URL("../../../apps/chromium/scripts/create-profile.ts", import.meta.url)
  .pathname;
const replaceScript = new URL("../../../apps/chromium/scripts/replace-chromium.sh", import.meta.url)
  .pathname;

function run(args: string[], options: Record<string, any> = {}) {
  const result = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe", ...options });
  if (!result.success) throw new Error(`${args[0]}: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

function temporary(): string {
  const root = run(["mktemp", "-d", "/tmp/luna-chromium-test-XXXXXX"]);
  roots.push(root);
  return root;
}

async function fixture() {
  const root = temporary();
  const data = `${root}/browser`;
  run(["mkdir", "-p", `${data}/Default`, `${data}/Profile 1`]);
  await Bun.write(`${root}/gitconfig`, '[user]\n  name = "Test Name / नमस्ते"\n');
  const env = {
    ...environment,
    HOME: root,
    XDG_DATA_HOME: `${root}/data`,
    LUNA_DATA_HOME_DIR: `${root}/data/luna`,
    XDG_CONFIG_HOME: `${root}/config`,
    CHROME_USER_DATA_DIR: data,
    GIT_CONFIG_GLOBAL: `${root}/gitconfig`,
    GIT_CONFIG_NOSYSTEM: "1",
    HYPRLAND_INSTANCE_SIGNATURE: "",
  };
  await Bun.write(
    `${data}/Default/Preferences`,
    '{ "profile": {"name":"Personal"}, "homepage":"keep" }\n',
  );
  await Bun.write(`${data}/Profile 1/Preferences`, '{"profile":{"name":"Other"}}\n');
  return { root, data, env, preferences: `${data}/Luna/Preferences` };
}

afterEach(() => {
  for (const key of Object.keys(Bun.env)) if (!(key in environment)) delete Bun.env[key];
  Object.assign(Bun.env, environment);
  for (const root of roots.splice(0)) run(["rm", "-r", "--", root]);
});

test("creation uses Git's display name and an existing profile is a byte-preserving no-op", async () => {
  const value = await fixture();
  const created = JSON.parse(run([Bun.which("bun")!, createScript], { env: value.env }));
  expect(created.name).toBe("Test Name / नमस्ते");
  expect(created.directory).toBe(`${value.data}/Luna`);
  const original = await Bun.file(value.preferences).text();
  run(["ln", "-s", "/missing/browser-lock", `${value.data}/SingletonLock`]);
  const repeated = JSON.parse(
    run([Bun.which("bun")!, createScript], {
      env: { ...value.env, GIT_CONFIG_GLOBAL: "/dev/null" },
    }),
  );
  expect(repeated.created).toBe(false);
  expect(await Bun.file(value.preferences).text()).toBe(original);
  expect(await Bun.file(`${value.data}/Default/Preferences`).text()).toContain('"homepage":"keep"');
});

test("creation rejects a missing Git identity and unverifiable Chromium locks", async () => {
  const value = await fixture();
  const missing = Bun.spawnSync([Bun.which("bun")!, createScript], {
    env: { ...value.env, GIT_CONFIG_GLOBAL: "/dev/null" },
    stderr: "pipe",
  });
  expect(missing.exitCode).not.toBe(0);
  expect(await Bun.file(value.preferences).exists()).toBe(false);
  run(["ln", "-s", "/missing/browser-lock", `${value.data}/SingletonLock`]);
  const locked = Bun.spawnSync([Bun.which("bun")!, createScript], {
    env: value.env,
    stderr: "pipe",
  });
  expect(locked.exitCode).not.toBe(0);
  expect(locked.stderr.toString()).toContain("Close Chromium");
  expect(await Bun.file(value.preferences).exists()).toBe(false);
});

test("merging defaults preserves user settings, null, arrays, and unrelated values", () => {
  const user = { profile: { name: "Mine", value: null }, list: [], unrelated: 1 };
  const defaults = { profile: { name: "Luna", value: true, added: 2 }, list: [1] };
  expect(withDefaults(user, defaults)).toEqual({ ...user, profile: { ...user.profile, added: 2 } });
  expect(user.profile).not.toHaveProperty("added");
  expect(() => withDefaults({}, JSON.parse('{"__proto__":{}}'))).toThrow("Unsupported");
});

const theme = {
  colors: Object.fromEntries(
    [
      "dark_background",
      "darker_background",
      "background",
      "foreground",
      "lighter_background",
      "light_foreground",
      "dark_foreground",
      "link",
      "accent",
    ].map((role) => [role, "#123456"]),
  ),
  fonts: { ui: 'Test "UI" Font', mono: "Test Mono" },
  appearance: { rounding: 0 },
};

test("appearance follows Luna's palette, escapes font names, and versions the relevant assets", () => {
  const result = appearance(theme);
  expect(result.native.theme.colors.frame).toEqual([18, 52, 86]);
  expect(result.css).toContain('font-family: "Test \\"UI\\" Font"');
  expect(result.css).toContain("border-radius: 0");
  const updated = appearance({ ...theme, fonts: { ...theme.fonts, ui: "Changed" } });
  expect(updated.native.version).toBe(result.native.version);
  expect(updated.websites.version).not.toBe(result.websites.version);
  const rounded = appearance({ ...theme, appearance: { rounding: 12 } });
  expect(rounded.css).not.toContain("border-radius");
  expect(rounded.websites.version).not.toBe(result.websites.version);
});

test("theme reads use fresh luna theme get --json output", async () => {
  const root = temporary();
  await Bun.write(
    `${root}/luna`,
    `#!/usr/bin/env bun
if (Bun.argv.slice(2).join(' ') !== 'theme get --json') process.exit(1);
console.log(JSON.stringify({succes:true,data:await Bun.file(Bun.env.FIXTURE_THEME!).json()}));
`,
  );
  run(["chmod", "+x", `${root}/luna`]);
  Bun.env.PATH = `${root}:${environment.PATH}`;
  Bun.env.FIXTURE_THEME = `${root}/theme.json`;
  await Bun.write(Bun.env.FIXTURE_THEME, JSON.stringify(theme));
  expect(currentTheme()).toEqual(theme);
  const changed = {
    ...theme,
    appearance: { rounding: 10 },
    colors: { ...theme.colors, dark_background: "#abcdef" },
  };
  await Bun.write(Bun.env.FIXTURE_THEME, JSON.stringify(changed));
  expect(currentTheme()).toEqual(changed);
  expect(appearance(currentTheme()).css).not.toContain("border-radius");
});

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function integer(value: number): Uint8Array {
  const bytes: number[] = [];
  do {
    const byte = value & 127;
    value >>>= 7;
    bytes.push(byte | (value ? 128 : 0));
  } while (value);
  return new Uint8Array(bytes);
}

function field(number: number, value: Uint8Array): Uint8Array {
  return concat(integer((number << 3) | 2), integer(value.length), value);
}

async function signedPackage(extra?: (directory: string) => Promise<void>) {
  const root = temporary();
  const source = `${root}/source`;
  run(["mkdir", source]);
  await Bun.write(
    `${source}/manifest.json`,
    JSON.stringify({ manifest_version: 3, name: "Test Extension", version: "1.0" }),
  );
  if (extra) await extra(source);
  run(["zip", "-q", "-r", "--symlinks", `${root}/archive.zip`, "."], { cwd: source });
  const archive = await Bun.file(`${root}/archive.zip`).bytes();
  const keys = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ["sign", "verify"],
  );
  const key = new Uint8Array(await crypto.subtle.exportKey("spki", keys.publicKey));
  const id = extensionId(key);
  const signed = field(1, new Bun.CryptoHasher("sha256").update(key).digest().subarray(0, 16));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, signed.length, true);
  const message = concat(new TextEncoder().encode("CRX3 SignedData\0"), length, signed, archive);
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, message),
  );
  const header = concat(field(2, concat(field(1, key), field(2, signature))), field(10000, signed));
  const prefix = new Uint8Array(12);
  prefix.set(new TextEncoder().encode("Cr24"));
  new DataView(prefix.buffer).setUint32(4, 3, true);
  new DataView(prefix.buffer).setUint32(8, header.length, true);
  return { root, id, bytes: concat(prefix, header, archive), key };
}

test("CRX verification rejects another identity and tampered content", async () => {
  const value = await signedPackage();
  const verified = await verifiedArchive(value.bytes, value.id);
  expect(verified.key).toBe(value.key.toBase64());
  await expect(verifiedArchive(value.bytes, "a".repeat(32))).rejects.toThrow("identity");
  const tampered = value.bytes.slice();
  tampered[tampered.length - 1] ^= 1;
  await expect(verifiedArchive(tampered, value.id)).rejects.toThrow("signature");
});

test("system unzip extraction keeps the signed identity and rejects archive links", async () => {
  const value = await signedPackage();
  const extracted = await unpack(value.bytes, value.id, `${value.root}/unpacked`);
  const manifest = await Bun.file(`${extracted.directory}/manifest.json`).json();
  expect(extensionId(Uint8Array.fromBase64(manifest.key))).toBe(value.id);
  const linked = await signedPackage(async (directory) => {
    run(["ln", "-s", "/tmp", `${directory}/outside`]);
  });
  await expect(unpack(linked.bytes, linked.id, `${linked.root}/unpacked`)).rejects.toThrow(
    "symbolic link",
  );
});

test("real Chromium setup recovers after SIGTERM, persists extensions and preserves other profiles", async () => {
  const value = await fixture();
  run([Bun.which("bun")!, createScript], { env: value.env });
  Object.assign(Bun.env, value.env);
  const defaultsBefore = await Bun.file(`${value.data}/Default/Preferences`).text();
  const otherBefore = await Bun.file(`${value.data}/Profile 1/Preferences`).text();
  const extension = await signedPackage();
  const config = {
    extensions: [extension.id],
    preferences: {
      extensions: { ui: { developer_mode: true } },
      profile: { default_content_setting_values: { cookies: 1 } },
    },
  };
  const prepare = async (_ids: string[], _version: string, stage: string) => [
    await unpack(extension.bytes, extension.id, `${stage}/${extension.id}`),
  ];
  // App configuration sends SIGTERM; Chromium can exit without removing its singleton links.
  const browser = Bun.spawn(
    [
      Bun.which("chromium")!,
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-background-networking",
      "--no-first-run",
      `--user-data-dir=${value.data}`,
      "--profile-directory=Luna",
      "about:blank",
    ],
    { env: value.env, stdout: "ignore", stderr: "ignore" },
  );
  try {
    const deadline = Date.now() + 10_000;
    while (!(await lstat(`${value.data}/SingletonLock`).catch(() => null))) {
      if (Date.now() > deadline || browser.exitCode !== null)
        throw new Error("Fixture Chromium did not start");
      await Bun.sleep(25);
    }
    browser.kill("SIGTERM");
    await browser.exited;
    expect(await readlink(`${value.data}/SingletonLock`)).toEndWith(`-${browser.pid}`);
  } finally {
    if (browser.exitCode === null) browser.kill("SIGKILL");
    await browser.exited;
  }
  const retiredDirectory = `${value.data}/Luna/Luna/extensions/better-whatsapp-web`;
  const retiredId = extensionId(retiredDirectory);
  await Bun.write(
    `${retiredDirectory}/manifest.json`,
    JSON.stringify({ manifest_version: 3, name: "Retired fixture", version: "1.0" }),
  );
  const oldBrowser = startBrowser(Bun.which("chromium")!, {
    root: value.data,
    directory: `${value.data}/Luna`,
    preferences: value.preferences,
    assets: "",
  });
  try {
    await oldBrowser.call("Extensions.loadUnpacked", { path: retiredDirectory });
  } finally {
    await oldBrowser.close();
  }
  const oldPreferences = await Bun.file(value.preferences).json();
  oldPreferences.extensions.settings[retiredId].creation_flags &= ~(1 << 15);
  oldPreferences.extensions.settings[retiredId].disable_reasons = [1];
  await Bun.write(value.preferences, JSON.stringify(oldPreferences));
  const first = await setupProfile(config, theme, prepare);
  expect(await lstat(retiredDirectory).catch(() => null)).toBeNull();
  expect(first.extensions).toContain(extension.id);
  expect(first.extensions.length).toBe(4);
  const preferences = await Bun.file(value.preferences).json();
  expect(preferences.extensions.settings).not.toHaveProperty(retiredId);
  expect(preferences.profile.name).toBe("Test Name / नमस्ते");
  expect(preferences.profile.default_content_setting_values.cookies).toBe(1);
  expect(preferences.extensions.settings[extension.id].creation_flags & (1 << 15)).toBe(0);
  preferences.homepage = "https://user.example/";
  preferences.webkit.webprefs.fonts.standard.Zyyy = "User Font";
  preferences.extensions.settings[extension.id].disable_reasons = [1];
  await Bun.write(value.preferences, JSON.stringify(preferences));
  const updatedTheme = {
    ...theme,
    colors: { ...theme.colors, dark_background: "#abcdef" },
    appearance: { rounding: 12 },
  };
  const second = await setupProfile(config, updatedTheme, prepare);
  expect(second.extensions).not.toContain(extension.id);
  const repeated = await Bun.file(value.preferences).json();
  expect(repeated.homepage).toBe("https://user.example/");
  expect(repeated.webkit.webprefs.fonts.standard.Zyyy).toBe("User Font");
  expect(repeated.extensions.settings[extension.id].disable_reasons).toContain(1);
  const native = await Bun.file(
    `${value.data}/Luna/Luna Next/appearance/theme/manifest.json`,
  ).json();
  expect(native.theme.colors.frame).toEqual([171, 205, 239]);
  expect(
    await Bun.file(`${value.data}/Luna/Luna Next/appearance/websites/style.css`).text(),
  ).not.toContain("border-radius");
  expect(await Bun.file(`${value.data}/Default/Preferences`).text()).toBe(defaultsBefore);
  expect(await Bun.file(`${value.data}/Profile 1/Preferences`).text()).toBe(otherBefore);
}, 30_000);

test("replacement keeps the package transaction atomic and accepts only the browser conflict", async () => {
  const root = temporary();
  const bin = `${root}/bin`;
  run(["mkdir", bin]);
  await Bun.write(`${root}/state`, "chromium\n");
  await Bun.write(
    `${bin}/pacman`,
    `#!/usr/bin/env bash
if [[ "$1" == -Qq ]]; then cat "$FIXTURE_ROOT/state"; else printf '%s\\n' ungoogled-chromium-bin; fi
`,
  );
  await Bun.write(
    `${bin}/yay`,
    `#!/usr/bin/env bash
printf '%s\\n' "$@" > "$FIXTURE_ROOT/arguments"
printf '%s\\n' ungoogled-chromium-bin > "$FIXTURE_ROOT/state"
`,
  );
  run(["chmod", "+x", `${bin}/pacman`, `${bin}/yay`]);
  const env = { ...environment, PATH: `${bin}:${environment.PATH}`, FIXTURE_ROOT: root };
  run(["bash", replaceScript], { env });
  expect(await Bun.file(`${root}/arguments`).text()).toBe(
    "-S\n--needed\n--noconfirm\n--ask\n4\n--\nungoogled-chromium-bin\n",
  );
  run(["unlink", `${root}/arguments`]);
  run(["bash", replaceScript], { env });
  expect(await Bun.file(`${root}/arguments`).exists()).toBe(false);
});

test("only clicked links in registered apps leave Chromium", async () => {
  const value = await fixture();
  let externalRequests = 0;
  const external = Bun.serve({
    port: 0,
    fetch: () => {
      externalRequests++;
      return new Response(
        '<title>Ordinary page</title><a id="link" href="https://unrelated.example/">Link</a>',
        { headers: { "Content-Type": "text/html" } },
      );
    },
  });
  const externalUrl = `http://127.0.0.1:${external.port}/article?query=test#section`;
  const internal = Bun.serve({
    port: 0,
    fetch: () =>
      new Response(
        `<title>Luna fixture</title>
    <a id="link" href="${externalUrl}">External</a>
    <a id="internal" href="/inside">Internal</a>
    <a id="download" href="${externalUrl}" download>Download</a>
    <form method="post" action="${externalUrl}"><button>Submit</button></form>`,
        { headers: { "Content-Type": "text/html" } },
      ),
  });
  const internalUrl = `http://127.0.0.1:${internal.port}/`;
  run(["mkdir", "-p", `${value.root}/bin`]);
  await Bun.write(`${value.root}/bin/xdg-mime`, '#!/bin/sh\nprintf "zen.desktop\\n"\n');
  await Bun.write(
    `${value.root}/bin/gio`,
    `#!/usr/bin/env bun
if (await Bun.file(Bun.env.LUNA_TEST_OPEN_LOG + ".fail").exists()) { console.error("Fixture opener failure"); process.exit(1); }
await Bun.write(Bun.env.LUNA_TEST_OPEN_LOG!, JSON.stringify(Bun.argv.slice(2)));
`,
  );
  run(["chmod", "+x", `${value.root}/bin/xdg-mime`, `${value.root}/bin/gio`]);
  const log = `${value.root}/opened.json`;
  Object.assign(Bun.env, value.env, {
    PATH: `${value.root}/bin:${environment.PATH}`,
    LUNA_TEST_OPEN_LOG: log,
  });
  const appId = `luna-webapp-${Buffer.from("Fixture").toString("hex")}`;
  await Bun.write(
    `${value.root}/data/luna/webapps/${appId}/app.jsonc`,
    JSON.stringify({ id: appId, name: "Fixture", url: internalUrl }),
  );
  run([Bun.which("bun")!, createScript], { env: { ...Bun.env } });
  let browser: ReturnType<typeof startBrowser> | undefined;
  async function waitFor(check: () => Promise<boolean>) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (await check()) return;
      await Bun.sleep(40);
    }
    throw new Error(
      "Browser routing timed out: " + JSON.stringify(await browser?.call("Target.getTargets")),
    );
  }
  async function evaluate(session: string, expression: string) {
    const result = await browser!.call(
      "Runtime.evaluate",
      { expression, returnByValue: true },
      session,
    );
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async function page(url: string) {
    const { targetId } = await browser!.call("Target.createTarget", { url });
    const { sessionId } = await browser!.call("Target.attachToTarget", { targetId, flatten: true });
    await waitFor(
      async () =>
        (await evaluate(sessionId, "document.readyState")) === "complete" &&
        (await evaluate(sessionId, "location.href")) === url,
    );
    return sessionId;
  }
  async function appPage() {
    const session = await page(internalUrl);
    const contexts: number[] = [];
    const unsubscribe = browser!.onEvent((event) => {
      if (
        event.sessionId === session &&
        event.method === "Runtime.executionContextCreated" &&
        !event.params.context.auxData?.isDefault
      )
        contexts.push(event.params.context.id);
    });
    try {
      await browser!.call("Runtime.enable", {}, session);
      // Inspect the isolated extension world; main-world listeners exclude it.
      await waitFor(async () => {
        for (const contextId of contexts) {
          const { result } = await browser!.call(
            "Runtime.evaluate",
            {
              expression: "getEventListeners(window).click?.length || 0",
              contextId,
              includeCommandLineAPI: true,
              returnByValue: true,
            },
            session,
          );
          if (result.value > 0) return true;
        }
        return false;
      });
    } finally {
      unsubscribe();
    }
    return session;
  }
  async function click(session: string, id: string, button = "left", modifiers = 0) {
    const rect = await evaluate(
      session,
      `(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 }; })()`,
    );
    await browser!.call(
      "Input.dispatchMouseEvent",
      { type: "mousePressed", ...rect, button, modifiers, clickCount: 1 },
      session,
    );
    await browser!.call(
      "Input.dispatchMouseEvent",
      { type: "mouseReleased", ...rect, button, modifiers, clickCount: 1 },
      session,
    );
  }
  try {
    await setupProfile(
      { extensions: [], preferences: { extensions: { ui: { developer_mode: true } } } },
      theme,
      async () => [],
    );
    browser = startBrowser(Bun.which("chromium")!, {
      root: value.data,
      directory: `${value.data}/Luna`,
      preferences: value.preferences,
      assets: `${value.data}/Luna/Luna Next`,
    });
    const ordinary = await page(externalUrl);
    expect(externalRequests).toBeGreaterThan(0);
    expect(await Bun.file(log).exists()).toBe(false);
    // Even on an app tab, an address-bar navigation must remain in Chromium.
    const typed = await appPage();
    await browser.call("Page.navigate", { url: externalUrl }, typed);
    await waitFor(async () => (await evaluate(typed, "document.title")) === "Ordinary page");
    expect(await Bun.file(log).exists()).toBe(false);
    // A page on the same host but a different port is not the installed app.
    await evaluate(
      ordinary,
      `document.getElementById('link').href = ${JSON.stringify(externalUrl + "2")}`,
    );
    await click(ordinary, "link");
    await waitFor(async () => (await evaluate(ordinary, "location.href")) === externalUrl + "2");
    expect(await Bun.file(log).exists()).toBe(false);
    const app = await appPage();
    const before = externalRequests;
    const targetsBefore = (await browser.call("Target.getTargets")).targetInfos.length;
    await click(app, "link");
    await waitFor(() => Bun.file(log).exists());
    expect(await Bun.file(log).json()).toEqual(["open", externalUrl]);
    await waitFor(async () => (await evaluate(app, "location.href")) === internalUrl);
    expect(externalRequests).toBe(before);
    expect((await browser.call("Target.getTargets")).targetInfos.length).toBe(targetsBefore);
    // New tabs, modifier clicks, middle clicks and keyboard activation also route.
    for (const mode of ["blank", "ctrl", "middle", "keyboard"]) {
      const session = await appPage();
      const count = (await browser.call("Target.getTargets")).targetInfos.length;
      run(["unlink", log]);
      if (mode === "blank")
        await evaluate(session, "document.getElementById('link').target = '_blank'");
      if (mode === "keyboard") {
        await evaluate(session, "document.getElementById('link').focus()");
        await browser.call(
          "Input.dispatchKeyEvent",
          { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
          session,
        );
        await browser.call(
          "Input.dispatchKeyEvent",
          { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
          session,
        );
      } else
        await click(
          session,
          "link",
          mode === "middle" ? "middle" : "left",
          mode === "ctrl" ? 2 : 0,
        );
      await waitFor(() => Bun.file(log).exists());
      expect(await Bun.file(log).json()).toEqual(["open", externalUrl]);
      expect(externalRequests).toBe(before);
      expect((await browser.call("Target.getTargets")).targetInfos.length).toBe(count);
    }
    run(["unlink", log]);
    const inside = await appPage();
    await click(inside, "internal");
    await waitFor(async () => (await evaluate(inside, "location.pathname")) === "/inside");
    expect(await Bun.file(log).exists()).toBe(false);
    const post = await appPage();
    await evaluate(post, "document.querySelector('form').submit()");
    await waitFor(async () => (await evaluate(post, "document.title")) === "Ordinary page");
    expect(await Bun.file(log).exists()).toBe(false);
    const failed = await appPage();
    await Bun.write(log + ".fail", "fail");
    await click(failed, "link");
    let errorTab: { targetId: string; url: string } | undefined;
    await waitFor(async () => {
      errorTab = (await browser!.call("Target.getTargets")).targetInfos.find(
        (target: { url: string }) => target.url.includes("/open.html?"),
      );
      return Boolean(errorTab);
    });
    expect(await evaluate(failed, "location.href")).toBe(internalUrl);
    const { sessionId: retrySession } = await browser.call("Target.attachToTarget", {
      targetId: errorTab!.targetId,
      flatten: true,
    });
    await waitFor(
      async () =>
        (await evaluate(retrySession, "document.getElementById('retry')?.hidden")) === false,
    );
    expect(await evaluate(retrySession, "document.getElementById('status').textContent")).toContain(
      "Fixture opener failure",
    );
    run(["unlink", log + ".fail"]);
    await click(retrySession, "retry");
    await waitFor(() => Bun.file(log).exists());
    await waitFor(
      async () =>
        !(await browser!.call("Target.getTargets")).targetInfos.some(
          (target: { targetId: string }) => target.targetId === errorTab!.targetId,
        ),
    );
    expect(await Bun.file(log).json()).toEqual(["open", externalUrl]);
  } finally {
    await browser?.close();
    internal.stop(true);
    external.stop(true);
  }
}, 60_000);
