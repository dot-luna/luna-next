#!/usr/bin/env bun
/**
 * Configure the existing Luna Chromium profile for PWAs without installation dialogs.
 * Run with system Bun: bun apps/chromium/scripts/setup-profile.ts
 *
 * Steps:
 * 1. Require Chromium to be closed and locate the Luna profile made by create-profile.ts.
 * 2. Read config/settings.jsonc and the resolved palette/fonts from `luna theme get --json`.
 * 3. Download and verify the declared CRX3 packages, then extract them with system unzip.
 * 4. Add missing preferences and generate browser colors/fonts; square websites only for zero rounding.
 * 5. Open only Luna in a temporary headless process, verify its exact profile path, and install.
 * 6. After Chromium exits, remove its transient CDP marker from our own installation records.
 * 7. Restart headlessly to check that the extensions remain installed and enabled, then exit.
 *
 * User preferences, disabled extensions, and other chosen themes take precedence. Browser data
 * stays in Chromium's normal user-data directory. This script creates no second browser entry,
 * global flags, policies, backups, or exported settings. It never closes a user's running browser.
 * The Luna CLI is the source of truth for colors, fonts, and rounding; Hyprland is never queried.
 * Rerun setup after theme changes to regenerate the browser's appearance.
 * Our unpacked extensions update when setup is rerun. Website CSS cannot alter native browser
 * controls, protected pages, or closed shadow roots. CDP record handling is specific to Linux
 * Chromium; failure is reported instead of silently switching installation methods.
 *
 * Dependencies: system Bun, Ungoogled Chromium, Luna CLI, unzip, and Linux coreutils.
 * No Node.js runtime or npm runtime dependencies are needed; root Bun types are editor-only.
 */

type Json = { [key: string]: any };
type Paths = { root: string; directory: string; preferences: string; assets: string };
type Extension = { id: string; directory: string };
type Settings = { extensions: string[]; preferences?: Json };
type Theme = { colors: Record<string, string>; fonts: { ui: string; mono: string }; appearance: { rounding: number } };

function run(args: string[]): string {
  const result = Bun.spawnSync(args, { stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 30_000,
    env: { ...Bun.env, LC_ALL: "C" } });
  if (!result.success) throw new Error(`${args[0]}: ${result.stderr.toString().trim() || result.exitCode}`);
  return result.stdout.toString().trim();
}

function test(flag: string, path: string): boolean {
  const result = Bun.spawnSync(["test", flag, path]);
  if (result.exitCode > 1) throw new Error(`Cannot inspect ${path}`);
  return result.exitCode === 0;
}

function profilePaths(): Paths {
  const base = Bun.env.CHROME_CONFIG_HOME || Bun.env.XDG_CONFIG_HOME
    || (Bun.env.HOME ? `${Bun.env.HOME}/.config` : "");
  const root = (Bun.env.CHROME_USER_DATA_DIR || (base ? `${base}/chromium` : "")).replace(/\/+$/u, "");
  if (!root.startsWith("/") || /[\x00-\x1f\x7f]/u.test(root)
    || root.split("/").some(part => part === "." || part === "..")) {
    throw new Error("Chromium's user-data directory must be an absolute path without '..'.");
  }
  return { root, directory: `${root}/Luna`, preferences: `${root}/Luna/Preferences`, assets: `${root}/Luna/Luna Next` };
}

function checkPath(path: string): void {
  let current = "";
  for (const part of path.split("/").filter(Boolean)) {
    current += `/${part}`;
    if (test("-L", current) || (test("-e", current) && !test("-d", current) && !test("-f", current))) {
      throw new Error(`Expected a regular file or directory: ${current}`);
    }
  }
}

function requireIdle(paths: Paths): void {
  for (const marker of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    const path = `${paths.root}/${marker}`;
    if (test("-e", path) || test("-L", path)) throw new Error(`Close Chromium first (${marker} exists).`);
  }
}

function object(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readObject(path: string): Promise<Json> {
  checkPath(path);
  const value = await Bun.file(path).json();
  if (!object(value)) throw new Error(`Expected a JSON object: ${path}`);
  return value;
}

/** Missing leaves inherit defaults; existing null, arrays, and scalar values remain user choices. */
export function withDefaults(current: Json, defaults: Json): Json {
  const result = structuredClone(current);
  for (const [key, value] of Object.entries(defaults)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error(`Unsupported preference key: ${key}`);
    if (!Object.hasOwn(result, key)) result[key] = structuredClone(value);
    else if (object(result[key]) && object(value)) result[key] = withDefaults(result[key], value);
  }
  return result;
}

/** Atomic file publication detects intervening edits; this is not a lock shared with Chromium. */
async function saveObject(path: string, value: Json, original?: string): Promise<void> {
  checkPath(path);
  const temporary = run(["mktemp", "--", `${path}.luna-XXXXXX`]);
  try {
    await Bun.write(temporary, `${JSON.stringify(value, null, 2)}\n`);
    if (original !== undefined && await Bun.file(path).text() !== original) {
      throw new Error(`File changed during Chromium setup: ${path}`);
    }
    checkPath(path);
    run(["mv", "-T", "--", temporary, path]);
  } finally {
    if (test("-f", temporary)) run(["unlink", "--", temporary]);
  }
}

const colorRoles: Record<string, string> = {
  frame: "dark_background", frame_inactive: "darker_background",
  toolbar: "background", toolbar_text: "foreground", toolbar_button_icon: "foreground",
  bookmark_text: "foreground", button_background: "lighter_background",
  background_tab: "dark_background", background_tab_inactive: "darker_background",
  tab_text: "foreground", tab_background_text: "light_foreground",
  tab_background_text_inactive: "dark_foreground", omnibox_background: "lighter_background",
  omnibox_text: "foreground", ntp_background: "background", ntp_text: "foreground",
  ntp_link: "link", ntp_header: "accent",
};

/** Read the current resolved theme on every run; source HOCON and defaults stay owned by Luna. */
export function currentTheme(): Theme {
  const response = JSON.parse(run(["luna", "theme", "get", "--json"]));
  if (response.ok !== true) throw new Error(response.error || "Cannot resolve Luna's theme.");
  return response.result;
}

/** Trust Luna's resolved theme, overriding website corners only when its rounding is zero. */
export function appearance(theme: Theme) {
  const colors = Object.fromEntries(Object.entries(colorRoles).map(([key, role]) => {
    const color = theme.colors[role];
    return [key, [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16))];
  }));
  // Target text elements instead of overriding explicit icon-font families everywhere.
  const corners = theme.appearance.rounding === 0 ? "*, *::before, *::after { border-radius: 0 !important; }\n" : "";
  const css = `${corners}body, button, input, optgroup, option, select, textarea {
  font-family: ${JSON.stringify(theme.fonts.ui)}, sans-serif !important;
}
pre, code, kbd, samp, pre *, code *, kbd *, samp * {
  font-family: ${JSON.stringify(theme.fonts.mono)}, monospace !important;
}
`;
  function version(value: string): string {
    const hash = new Bun.CryptoHasher("sha256").update(value).digest();
    const view = new DataView(hash.buffer, hash.byteOffset, hash.byteLength);
    return [0, 2, 4, 6].map(offset => view.getUint16(offset)).join(".");
  }
  const native = { manifest_version: 3, name: "Luna Next Browser Theme", theme: { colors } };
  const websites = { manifest_version: 3, name: "Luna Next Website Appearance",
    content_scripts: [{ matches: ["http://*/*", "https://*/*"], css: ["style.css"], all_frames: true, run_at: "document_start" }] };
  return { native: { ...native, version: version(JSON.stringify(native)) },
    websites: { ...websites, version: version(JSON.stringify(websites) + css) }, css };
}

export function extensionId(key: Uint8Array | string): string {
  return new Bun.CryptoHasher("sha256").update(key).digest("hex").slice(0, 32)
    .replace(/[0-9a-f]/gu, digit => String.fromCharCode(97 + parseInt(digit, 16)));
}

// CRX3 headers contain length-delimited protobuf fields; validate framing before reading proofs.
function fields(bytes: Uint8Array): Map<number, Uint8Array[]> {
  let offset = 0;
  const result = new Map<number, Uint8Array[]>();
  function integer(): number {
    let value = 0;
    for (let shift = 0; shift <= 28 && offset < bytes.length; shift += 7) {
      const byte = bytes[offset++];
      value += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) return value;
    }
    throw new Error("Invalid CRX protobuf integer.");
  }
  while (offset < bytes.length) {
    const tag = integer();
    if ((tag & 7) !== 2 || !(tag >> 3)) throw new Error("Invalid CRX protobuf field.");
    const size = integer();
    if (size > bytes.length - offset) throw new Error("Truncated CRX protobuf field.");
    const number = tag >> 3;
    result.set(number, [...(result.get(number) || []), bytes.subarray(offset, offset + size)]);
    offset += size;
  }
  return result;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

/** Authenticate the requested extension ID and its developer signature before unpacking code. */
export async function verifiedArchive(bytes: Uint8Array, id: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!/^[a-p]{32}$/u.test(id) || bytes.length < 12 || bytes.length > 128 * 1024 * 1024
    || new TextDecoder().decode(bytes.subarray(0, 4)) !== "Cr24" || view.getUint32(4, true) !== 3) {
    throw new Error(`Invalid CRX3 package or extension ID: ${id}`);
  }
  const size = view.getUint32(8, true);
  if (size > 1024 * 1024 || size + 12 >= bytes.length) throw new Error("Invalid CRX header size.");
  const header = fields(bytes.subarray(12, 12 + size));
  const signed = header.get(10000)?.[0];
  if (!signed) throw new Error("Missing CRX signed header.");
  const declared = fields(signed).get(1)?.[0];
  const expected = [...id].map(letter => (letter.charCodeAt(0) - 97).toString(16)).join("");
  if (!declared || declared.length !== 16 || declared.toHex() !== expected) throw new Error(`CRX identity does not match ${id}.`);
  const archive = bytes.subarray(12 + size);
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, signed.length, true);
  const message = concat(new TextEncoder().encode("CRX3 SignedData\0"), length, signed, archive);
  for (const proof of header.get(2) || []) {
    const values = fields(proof);
    const key = values.get(1)?.[0];
    const signature = values.get(2)?.[0];
    if (!key || !signature || extensionId(key) !== id) continue;
    const publicKey = await crypto.subtle.importKey("spki", new Uint8Array(key),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    if (await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, new Uint8Array(signature), message)) {
      return { archive, key: key.toBase64() };
    }
  }
  throw new Error(`Missing or invalid CRX3 RSA developer signature for ${id}.`);
}

/** Validate names, expansion size, and link types before invoking the system unzip command. */
export async function unpack(bytes: Uint8Array, id: string, directory: string): Promise<Extension> {
  const { archive, key } = await verifiedArchive(bytes, id);
  const zip = `${directory}.zip`;
  await Bun.write(zip, archive);
  const names = run(["unzip", "-Z1", zip]).split("\n");
  for (const name of names) {
    if (!name || name.startsWith("/") || name.includes("\\") || /[\x00-\x1f\x7f]/u.test(name)
      || name.split("/").some(part => part === ".." || part === ".")) throw new Error(`Unsafe archive path: ${name}`);
  }
  const size = run(["unzip", "-Z", "-t", zip]).match(/(\d+) bytes uncompressed/u)?.[1];
  if (!size || Number(size) > 512 * 1024 * 1024) throw new Error("Extension expands beyond 512 MiB.");
  if (/^l[rwx-]/mu.test(run(["unzip", "-Z", "-l", zip]))) throw new Error("Extension archive contains a symbolic link.");
  run(["mkdir", "-m", "700", "--", directory]);
  run(["unzip", "-q", zip, "-d", directory, "-x", "_metadata/*"]);
  const manifest = await readObject(`${directory}/manifest.json`);
  if (manifest.manifest_version !== 3 || typeof manifest.version !== "string") throw new Error(`Extension ${id} must use Manifest V3.`);
  // Preserve the signed package identity when loading from an unpacked folder.
  manifest.key = key;
  await saveObject(`${directory}/manifest.json`, manifest);
  run(["unlink", "--", zip]);
  return { id, directory };
}

async function downloadExtensions(ids: string[], version: string, stage: string): Promise<Extension[]> {
  if (!Array.isArray(ids) || ids.some(id => !/^[a-p]{32}$/u.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error("Expected unique Chromium extension IDs.");
  }
  const result: Extension[] = [];
  for (const id of ids) {
    const url = new URL("https://clients2.google.com/service/update2/crx");
    url.search = new URLSearchParams({ response: "redirect", acceptformat: "crx3", prodversion: version,
      x: `id=${id}&installsource=ondemand&uc` }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok || !response.body) throw new Error(`Extension ${id} download failed (${response.status}).`);
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 128 * 1024 * 1024) throw new Error(`Extension ${id} exceeds 128 MiB.`);
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    result.push(await unpack(concat(...chunks), id, `${stage}/${id}`));
  }
  return result;
}

/** Own a headless Chromium and a private CDP pipe, without opening a debugging TCP port. */
export function startBrowser(binary: string, paths: Paths) {
  const child = Bun.spawn([binary, `--user-data-dir=${paths.root}`, "--profile-directory=Luna",
    "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
    "--remote-debugging-pipe", "--enable-unsafe-extension-debugging", "about:blank"],
  { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  const input = Bun.file(child.stdio[3] as number).writer();
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  let nextId = 0;
  let diagnostics = "";
  const fail = (error: Error) => { for (const entry of pending.values()) entry.reject(error); pending.clear(); };
  void child.exited.then(code => fail(new Error(`Chromium exited (${code}): ${diagnostics.trim()}`)));
  void (async () => {
    const decoder = new TextDecoder();
    for await (const bytes of child.stderr as ReadableStream<Uint8Array>) diagnostics = (diagnostics + decoder.decode(bytes)).slice(-16_384);
  })().catch(fail);
  void (async () => {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const bytes of Bun.file(child.stdio[4] as number).stream()) {
      buffer += decoder.decode(bytes, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\0")) !== -1) {
        const message = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        const entry = pending.get(message.id);
        if (!entry) continue;
        pending.delete(message.id);
        if (message.error) entry.reject(new Error(message.error.message));
        else entry.resolve(message.result);
      }
    }
  })().catch(fail);

  function call(method: string, params = {}, sessionId?: string): Promise<any> {
    return new Promise((resolve, reject) => {
      if (child.exitCode !== null) { reject(new Error(`Chromium exited before ${method}: ${diagnostics}`)); return; }
      const id = ++nextId;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Chromium timed out during ${method}.`)); }, 15_000);
      pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } });
      input.write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
      void Promise.resolve(input.flush()).catch(error => { pending.get(id)?.reject(error); pending.delete(id); });
    });
  }
  async function close(): Promise<void> {
    const terminate = setTimeout(() => child.kill("SIGTERM"), 3000);
    const kill = setTimeout(() => child.kill("SIGKILL"), 5000);
    try {
      if (child.exitCode === null) await call("Browser.close").catch(() => {});
      await child.exited;
    } finally { clearTimeout(terminate); clearTimeout(kill); await Promise.resolve(input.end()).catch(() => {}); }
  }
  return { call, close };
}

async function verifyProfile(browser: ReturnType<typeof startBrowser>, paths: Paths): Promise<void> {
  const { targetId } = await browser.call("Target.createTarget", { url: "chrome://version/" });
  const { sessionId } = await browser.call("Target.attachToTarget", { targetId, flatten: true });
  const deadline = Date.now() + 5000;
  let selected: string | undefined;
  while (Date.now() < deadline) {
    const result = await browser.call("Runtime.evaluate", {
      expression: "document.querySelector('#profile_path')?.textContent.trim()", returnByValue: true,
    }, sessionId);
    selected = result.result?.value;
    if (selected) break;
    await Bun.sleep(20);
  }
  if (selected !== paths.directory) throw new Error("Chromium did not select Luna; no extensions were installed.");
  await browser.call("Target.closeTarget", { targetId });
}

async function installExtensions(binary: string, paths: Paths, extensions: Extension[]) {
  const browser = startBrowser(binary, paths);
  try {
    await verifyProfile(browser, paths);
    for (const item of extensions) {
      const installed = await browser.call("Extensions.loadUnpacked", { path: item.directory });
      if (installed.id !== item.id) throw new Error(`Installed the wrong extension: ${item.id}`);
    }
  } finally { await browser.close(); }
  requireIdle(paths);
  const original = await Bun.file(paths.preferences).text();
  const preferences = await readObject(paths.preferences);
  for (const item of extensions) {
    const entry = preferences.extensions?.settings?.[item.id];
    if (!entry || entry.path !== item.directory || !Number.isInteger(entry.creation_flags)) {
      throw new Error(`Chromium did not persist ${item.id} in Luna's Preferences.`);
    }
    // Chromium removes INSTALLED_VIA_CDP (extension.h, bit 15) at startup. Clear
    // only this transient marker on our own validated, persistent unpacked records.
    // Permission grants and Secure Preferences hashes are never manufactured.
    entry.creation_flags &= ~(1 << 15);
  }
  await saveObject(paths.preferences, preferences, original);
  const restarted = startBrowser(binary, paths);
  try {
    await verifyProfile(restarted, paths);
    const result = await restarted.call("Extensions.getExtensions");
    for (const item of extensions) {
      if (!result.extensions.some((entry: Json) => entry.id === item.id && entry.enabled)) {
        throw new Error(`Extension ${item.id} did not remain enabled after restart.`);
      }
    }
  } finally { await restarted.close(); }
}

/** Configure only the existing Luna profile; the optional arguments permit isolated fixture tests. */
export async function setupProfile(config?: Settings, theme?: Theme, prepare = downloadExtensions) {
  const paths = profilePaths();
  checkPath(paths.preferences);
  const original = await Bun.file(paths.preferences).text();
  const preferences = JSON.parse(original);
  if (!object(preferences)) throw new Error(`Expected a JSON object: ${paths.preferences}`);
  requireIdle(paths);
  const lock = `${paths.root}/.luna-setup.lock`;
  run(["mkdir", "-m", "700", "--", lock]);
  let stage: string | undefined;
  try {
    requireIdle(paths);
    const parsed = config ?? Bun.JSONC.parse(await Bun.file(new URL("../config/settings.jsonc", import.meta.url)).text());
    if (!object(parsed) || !Array.isArray(parsed.extensions) || !object(parsed.preferences ?? {})) {
      throw new Error("Invalid Chromium settings.jsonc.");
    }
    const settings = parsed as Settings;
    const selectedTheme = theme ?? currentTheme();
    const generated = appearance(selectedTheme);
    const fonts = Object.fromEntries(["standard", "sansserif", "serif", "fixed"].map(family => [
      family, { Zyyy: family === "fixed" ? selectedTheme.fonts.mono : selectedTheme.fonts.ui },
    ]));
    const values = withDefaults(preferences, withDefaults(settings.preferences || {}, { webkit: { webprefs: { fonts } } }));
    if (values.extensions?.ui?.developer_mode !== true) throw new Error("Enable developer mode in Luna's profile before installing unpacked extensions.");
    const binary = Bun.which("chromium");
    if (!binary) throw new Error("Install ungoogled-chromium-bin first.");
    const version = run([binary, "--version"]).match(/\b\d+\.\d+\.\d+\.\d+\b/u)?.[0];
    if (!version) throw new Error("Cannot read the installed Chromium version.");
    stage = run(["mktemp", "-d", "--", `${paths.root}/.luna-chromium-XXXXXX`]);
    const downloaded = await prepare(settings.extensions, version, stage);
    requireIdle(paths);
    if (await Bun.file(paths.preferences).text() !== original) throw new Error("Luna's profile changed during preparation.");
    checkPath(paths.assets);
    run(["mkdir", "-p", "-m", "700", "--", `${paths.assets}/extensions`, `${paths.assets}/appearance`]);
    const install: Extension[] = [];
    for (const item of downloaded) {
      const directory = `${paths.assets}/extensions/${item.id}`;
      replaceTree(item.directory, directory);
      install.push({ id: item.id, directory });
    }
    for (const [name, manifest] of [["theme", generated.native], ["websites", generated.websites]] as const) {
      const source = `${stage}/${name}`;
      run(["mkdir", "-m", "700", "--", source]);
      await saveObject(`${source}/manifest.json`, manifest);
      if (name === "websites") await Bun.write(`${source}/style.css`, generated.css);
      const directory = `${paths.assets}/appearance/${name}`;
      const id = extensionId(directory);
      replaceTree(source, directory);
      const previousTheme = preferences.extensions?.theme?.id;
      if (name === "websites" || previousTheme === id || (!previousTheme && !preferences.browser?.theme
        && !preferences.extensions?.theme?.system_theme)) install.push({ id, directory });
    }
    // An extension explicitly disabled by the user stays disabled on subsequent configuration runs.
    const selected = install.filter(item => !preferences.extensions?.settings?.[item.id]?.disable_reasons?.length);
    requireIdle(paths);
    await saveObject(paths.preferences, values, original);
    await installExtensions(binary, paths, selected);
    return { directory: paths.directory, name: preferences.profile?.name, extensions: selected.map(item => item.id) };
  } finally {
    if (stage) run(["rm", "-r", "--", stage]);
    run(["rmdir", "--", lock]);
  }
}

function replaceTree(source: string, target: string): void {
  checkPath(target);
  if (test("-e", target)) run(["rm", "-r", "--", target]);
  run(["mv", "-T", "--", source, target]);
}

if (import.meta.main) {
  try { console.log(JSON.stringify(await setupProfile())); }
  catch (error) { console.error(`Setup Chromium profile: ${(error as Error).message}`); process.exitCode = 1; }
}
