import { afterEach, expect, test } from "bun:test";
import { appearance, currentTheme, extensionId, setupProfile, unpack, verifiedArchive, withDefaults } from "../scripts/setup-profile.ts";

const roots: string[] = [];
const environment = { ...Bun.env };
const createScript = new URL("../scripts/create-profile.ts", import.meta.url).pathname;
const replaceScript = new URL("../scripts/replace-chromium.sh", import.meta.url).pathname;

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
  const env = { ...environment, CHROME_USER_DATA_DIR: data, GIT_CONFIG_GLOBAL: `${root}/gitconfig`,
    GIT_CONFIG_NOSYSTEM: "1", HYPRLAND_INSTANCE_SIGNATURE: "" };
  await Bun.write(`${data}/Default/Preferences`, '{ "profile": {"name":"Personal"}, "homepage":"keep" }\n');
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
  const repeated = JSON.parse(run([Bun.which("bun")!, createScript], {
    env: { ...value.env, GIT_CONFIG_GLOBAL: "/dev/null" },
  }));
  expect(repeated.created).toBe(false);
  expect(await Bun.file(value.preferences).text()).toBe(original);
  expect(await Bun.file(`${value.data}/Default/Preferences`).text()).toContain('"homepage":"keep"');
});

test("creation rejects a missing Git identity and stale Chromium locks", async () => {
  const value = await fixture();
  const missing = Bun.spawnSync([Bun.which("bun")!, createScript], {
    env: { ...value.env, GIT_CONFIG_GLOBAL: "/dev/null" }, stderr: "pipe",
  });
  expect(missing.exitCode).not.toBe(0);
  expect(await Bun.file(value.preferences).exists()).toBe(false);
  run(["ln", "-s", "/missing/browser-lock", `${value.data}/SingletonLock`]);
  const locked = Bun.spawnSync([Bun.which("bun")!, createScript], { env: value.env, stderr: "pipe" });
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
  colors: Object.fromEntries(["dark_background", "darker_background", "background", "foreground",
    "lighter_background", "light_foreground", "dark_foreground", "link", "accent"].map(role => [role, "#123456"])),
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
  await Bun.write(`${root}/luna`, `#!/usr/bin/env bun
if (Bun.argv.slice(2).join(' ') !== 'theme get --json') process.exit(1);
console.log(JSON.stringify({ok:true,result:await Bun.file(Bun.env.FIXTURE_THEME!).json()}));
`);
  run(["chmod", "+x", `${root}/luna`]);
  Bun.env.PATH = `${root}:${environment.PATH}`;
  Bun.env.FIXTURE_THEME = `${root}/theme.json`;
  await Bun.write(Bun.env.FIXTURE_THEME, JSON.stringify(theme));
  expect(currentTheme()).toEqual(theme);
  const changed = { ...theme, appearance: { rounding: 10 }, colors: { ...theme.colors, dark_background: "#abcdef" } };
  await Bun.write(Bun.env.FIXTURE_THEME, JSON.stringify(changed));
  expect(currentTheme()).toEqual(changed);
  expect(appearance(currentTheme()).css).not.toContain("border-radius");
});

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function integer(value: number): Uint8Array {
  const bytes: number[] = [];
  do { const byte = value & 127; value >>>= 7; bytes.push(byte | (value ? 128 : 0)); } while (value);
  return new Uint8Array(bytes);
}

function field(number: number, value: Uint8Array): Uint8Array {
  return concat(integer((number << 3) | 2), integer(value.length), value);
}

async function signedPackage(extra?: (directory: string) => Promise<void>) {
  const root = temporary();
  const source = `${root}/source`;
  run(["mkdir", source]);
  await Bun.write(`${source}/manifest.json`, JSON.stringify({ manifest_version: 3, name: "Test Extension", version: "1.0" }));
  if (extra) await extra(source);
  run(["zip", "-q", "-r", "--symlinks", `${root}/archive.zip`, "."], { cwd: source });
  const archive = await Bun.file(`${root}/archive.zip`).bytes();
  const keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256",
    modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ["sign", "verify"]);
  const key = new Uint8Array(await crypto.subtle.exportKey("spki", keys.publicKey));
  const id = extensionId(key);
  const signed = field(1, new Bun.CryptoHasher("sha256").update(key).digest().subarray(0, 16));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, signed.length, true);
  const message = concat(new TextEncoder().encode("CRX3 SignedData\0"), length, signed, archive);
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, message));
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
  const linked = await signedPackage(async directory => { run(["ln", "-s", "/tmp", `${directory}/outside`]); });
  await expect(unpack(linked.bytes, linked.id, `${linked.root}/unpacked`)).rejects.toThrow("symbolic link");
});

test("real Chromium setup persists extensions after restart and preserves other profiles", async () => {
  const value = await fixture();
  run([Bun.which("bun")!, createScript], { env: value.env });
  Object.assign(Bun.env, value.env);
  const defaultsBefore = await Bun.file(`${value.data}/Default/Preferences`).text();
  const otherBefore = await Bun.file(`${value.data}/Profile 1/Preferences`).text();
  const extension = await signedPackage();
  const config = { extensions: [extension.id], preferences: {
    extensions: { ui: { developer_mode: true } }, profile: { default_content_setting_values: { cookies: 1 } },
  } };
  const prepare = async (_ids: string[], _version: string, stage: string) => [
    await unpack(extension.bytes, extension.id, `${stage}/${extension.id}`),
  ];
  const first = await setupProfile(config, theme, prepare);
  expect(first.extensions).toContain(extension.id);
  expect(first.extensions.length).toBe(3);
  const preferences = await Bun.file(value.preferences).json();
  expect(preferences.profile.name).toBe("Test Name / नमस्ते");
  expect(preferences.profile.default_content_setting_values.cookies).toBe(1);
  expect(preferences.extensions.settings[extension.id].creation_flags & (1 << 15)).toBe(0);
  preferences.homepage = "https://user.example/";
  preferences.webkit.webprefs.fonts.standard.Zyyy = "User Font";
  preferences.extensions.settings[extension.id].disable_reasons = [1];
  await Bun.write(value.preferences, JSON.stringify(preferences));
  const updatedTheme = { ...theme, colors: { ...theme.colors, dark_background: "#abcdef" }, appearance: { rounding: 12 } };
  const second = await setupProfile(config, updatedTheme, prepare);
  expect(second.extensions).not.toContain(extension.id);
  const repeated = await Bun.file(value.preferences).json();
  expect(repeated.homepage).toBe("https://user.example/");
  expect(repeated.webkit.webprefs.fonts.standard.Zyyy).toBe("User Font");
  expect(repeated.extensions.settings[extension.id].disable_reasons).toContain(1);
  const native = await Bun.file(`${value.data}/Luna/Luna Next/appearance/theme/manifest.json`).json();
  expect(native.theme.colors.frame).toEqual([171, 205, 239]);
  expect(await Bun.file(`${value.data}/Luna/Luna Next/appearance/websites/style.css`).text()).not.toContain("border-radius");
  expect(await Bun.file(`${value.data}/Default/Preferences`).text()).toBe(defaultsBefore);
  expect(await Bun.file(`${value.data}/Profile 1/Preferences`).text()).toBe(otherBefore);
}, 30_000);

test("replacement keeps the package transaction atomic and accepts only the browser conflict", async () => {
  const root = temporary();
  const bin = `${root}/bin`;
  run(["mkdir", bin]);
  await Bun.write(`${root}/state`, "chromium\n");
  await Bun.write(`${bin}/pacman`, `#!/usr/bin/env bash
if [[ "$1" == -Qq ]]; then cat "$FIXTURE_ROOT/state"; else printf '%s\\n' ungoogled-chromium-bin; fi
`);
  await Bun.write(`${bin}/yay`, `#!/usr/bin/env bash
printf '%s\\n' "$@" > "$FIXTURE_ROOT/arguments"
printf '%s\\n' ungoogled-chromium-bin > "$FIXTURE_ROOT/state"
`);
  run(["chmod", "+x", `${bin}/pacman`, `${bin}/yay`]);
  const env = { ...environment, PATH: `${bin}:${environment.PATH}`, FIXTURE_ROOT: root };
  run(["bash", replaceScript], { env });
  expect(await Bun.file(`${root}/arguments`).text()).toBe("-S\n--needed\n--noconfirm\n--ask\n4\n--\nungoogled-chromium-bin\n");
  run(["unlink", `${root}/arguments`]);
  run(["bash", replaceScript], { env });
  expect(await Bun.file(`${root}/arguments`).exists()).toBe(false);
});
