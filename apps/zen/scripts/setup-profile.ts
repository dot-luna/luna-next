#!/usr/bin/env bun
/**
 * Apply Luna's appearance and signed extensions to one existing Zen profile.
 * Run with system Bun: bun apps/zen/scripts/setup-profile.ts [--profile /absolute/path]
 *
 * Steps:
 * 1. Read config/settings.jsonc and select Zen's native default, or the explicit profile.
 * 2. Skip a missing default; reject ambiguous profiles, unsafe paths, and browser locks.
 * 3. Hold Gecko's record lock while resolving luna theme get --json and rendering the CSS.
 * 4. Stage the declared Mozilla XPIs and check their identities and signature-file presence.
 * 5. Recheck browser-owned inputs, then atomically replace only user.js, Luna CSS, and those XPIs.
 *
 * Browser data, prefs.js, profiles.ini, other extensions, and other profiles stay untouched.
 * No profiles or backups are created. Zen verifies XPI signatures and loads the files on its
 * next start; setup does not open Zen, change extension registries, or reenable disabled add-ons.
 * Luna owns theme resolution; failure stops setup, and square corners apply only for rounding 0.
 * Rerun after theme changes or to refresh extension downloads. A late publication failure can
 * leave earlier declared files updated; fix the error and rerun.
 *
 * Standalone Bun script: no app package, lockfile, or runtime dependencies to install with npm.
 * Requires Luna, curl, unzip, Linux coreutils, and util-linux flock with --fcntl support.
 */

type Extension = { id: string; url: string };
type Settings = { extensions: Extension[]; preferences: Record<string, string | number | boolean> };
type Theme = {
  colors: Record<string, string>;
  fonts: { ui: string; mono: string };
  appearance: { rounding: number };
};
type Snapshot = { path: string; bytes: Buffer | null; mode: number };
type Profile = { directory: string; registry?: Snapshot; preferences: Snapshot };

const config = new URL("../config/", import.meta.url);
const maxPackage = 64 * 1024 * 1024;
const maxManifest = 1024 * 1024;

function run(args: string[], timeout = 30_000): string {
  const result = Bun.spawnSync(args, {
    stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout,
    env: { ...Bun.env, LC_ALL: "C" },
  });
  if (!result.success) throw new Error(args[0] + ": " + (result.stderr.toString().trim() || result.exitCode));
  return result.stdout.toString().trim();
}

function test(flag: string, path: string): boolean {
  const result = Bun.spawnSync(["test", flag, path]);
  if (result.exitCode > 1) throw new Error("Cannot inspect " + path);
  return result.exitCode === 0;
}

function absolute(path: string): string {
  if (!path || /[\x00-\x1f\x7f]/u.test(path) || path.split("/").includes("..")) {
    throw new Error("Zen paths must be nonempty and cannot contain '..' or control characters.");
  }
  const parts = (path.startsWith("/") ? path : process.cwd() + "/" + path).split("/");
  const result = "/" + parts.filter(part => part && part !== ".").join("/");
  if (result === "/") throw new Error("A Zen path cannot be the filesystem root.");
  return result;
}

// Reject links in every component so publication cannot escape through an existing parent.
function checkPath(path: string): void {
  let current = "";
  for (const part of path.split("/").filter(Boolean)) {
    current += "/" + part;
    if (test("-L", current) || (test("-e", current) && !test("-d", current) && !test("-f", current))) {
      throw new Error("Zen paths must be ordinary files or directories: " + current);
    }
  }
}

async function bytes(path: string): Promise<Buffer | null> {
  checkPath(path);
  if (!test("-e", path)) return null;
  if (!test("-f", path)) throw new Error("Expected a regular Zen file: " + path);
  return Buffer.from(await Bun.file(path).arrayBuffer());
}

async function snapshot(path: string): Promise<Snapshot> {
  const original = await bytes(path);
  const mode = original ? (await Bun.file(path).stat()).mode & 0o777 : 0o600;
  return { path, bytes: original, mode };
}

async function unchanged(file: Snapshot): Promise<void> {
  const current = await bytes(file.path);
  if (file.bytes === null ? current !== null : current === null || !file.bytes.equals(current)) {
    throw new Error("Zen file changed during setup: " + file.path);
  }
  if (current && ((await Bun.file(file.path).stat()).mode & 0o777) !== file.mode) {
    throw new Error("Zen file permissions changed during setup: " + file.path);
  }
}

async function publish(file: Snapshot, contents: string | Buffer): Promise<void> {
  await unchanged(file);
  const parent = file.path.slice(0, file.path.lastIndexOf("/"));
  run(["mkdir", "-p", "-m", "700", "--", parent]);
  checkPath(file.path);
  const temporary = run(["mktemp", "--", file.path + ".luna-XXXXXX"]);
  try {
    await Bun.write(temporary, contents);
    run(["chmod", file.mode.toString(8), "--", temporary]);
    await unchanged(file);
    run(["mv", "-fT", "--", temporary, file.path]);
  } finally {
    run(["rm", "-f", "--", temporary]);
  }
}

function sections(source: string): Map<string, Map<string, string>> {
  const result = new Map<string, Map<string, string>>();
  let current: Map<string, string> | undefined;
  for (const original of source.split(/\r?\n/u)) {
    const line = original.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const header = /^\[([^\]]+)\]$/u.exec(line);
    if (header) {
      if (result.has(header[1])) throw new Error("Duplicate section in Zen profiles.ini.");
      current = new Map();
      result.set(header[1], current);
      continue;
    }
    const separator = line.indexOf("=");
    const key = line.slice(0, separator).trim();
    if (!current || separator < 1 || !key || current.has(key)) throw new Error("Invalid Zen profiles.ini.");
    current.set(key, line.slice(separator + 1).trim());
  }
  return result;
}

async function profile(explicit?: string): Promise<Profile | null> {
  let directory: string;
  let registry: Snapshot | undefined;
  if (explicit) {
    directory = absolute(explicit);
  } else {
    if (!Bun.env.HOME) throw new Error("HOME is required.");
    const home = absolute(Bun.env.HOME);
    const native = home + "/.zen";
    const root = test("-e", native) || test("-L", native)
      ? native : absolute(Bun.env.XDG_CONFIG_HOME || home + "/.config") + "/zen";
    registry = await snapshot(root + "/profiles.ini");
    if (registry.bytes === null) return null;
    const entries = sections(new TextDecoder("utf-8", { fatal: true }).decode(registry.bytes));
    const installed = new Set<string>(), defaults = new Set<string>(), all = new Set<string>();
    const registryPath = (value: string | undefined, relative?: string): string => {
      if (!value || (relative !== undefined && relative !== "0" && relative !== "1")
        || (relative === "1" && value.startsWith("/")) || (relative === "0" && !value.startsWith("/"))) {
        throw new Error("Invalid profile path or IsRelative in Zen profiles.ini.");
      }
      return absolute(value.startsWith("/") ? value : root + "/" + value);
    };
    for (const [name, values] of entries) {
      if (name.startsWith("Install") && values.has("Default")) {
        installed.add(registryPath(values.get("Default")));
      }
    }
    if (!installed.size) {
      for (const [name, values] of entries) {
        if (name.startsWith("Profile")) {
          if (!values.has("IsRelative")) throw new Error("Zen profile is missing IsRelative.");
          const path = registryPath(values.get("Path"), values.get("IsRelative"));
          all.add(path);
          if (values.get("Default") === "1") defaults.add(path);
        }
      }
    }
    const candidates = installed.size ? installed : defaults.size ? defaults : all;
    if (!candidates.size) return null;
    if (candidates.size !== 1) throw new Error("Zen has multiple default profiles; select one with --profile PATH.");
    directory = candidates.values().next().value!;
  }
  checkPath(directory);
  const preferences = await snapshot(directory + "/prefs.js");
  if (!test("-d", directory) || preferences.bytes === null) {
    if (!explicit) return null;
    throw new Error("Open Zen once to create this profile, then close it: " + directory);
  }
  const app = absolute(Bun.fileURLToPath(new URL("../", import.meta.url)));
  if (directory === app || directory.startsWith(app + "/") || app.startsWith(directory + "/")) {
    throw new Error("Zen profile overlaps the app settings.");
  }
  return { directory, registry, preferences };
}

async function settings(): Promise<Settings> {
  const value = Bun.JSONC.parse(await Bun.file(new URL("settings.jsonc", config)).text()) as Settings;
  if (!value || !Array.isArray(value.extensions) || !value.preferences
    || typeof value.preferences !== "object" || Array.isArray(value.preferences)) {
    throw new Error("Zen settings require extensions and preferences.");
  }
  const ids = new Set<string>();
  for (const extension of value.extensions) {
    if (!extension || typeof extension.id !== "string" || extension.id.length > 200
      || !/^(?:[A-Za-z0-9._+-]+@[A-Za-z0-9._-]+|\{[0-9a-fA-F-]{36}\})$/u.test(extension.id)
      || ids.has(extension.id)) throw new Error("Invalid or duplicate Zen extension ID.");
    ids.add(extension.id);
    if (typeof extension.url !== "string"
      || !/^https:\/\/addons\.mozilla\.org\/firefox\/downloads\/latest\/[A-Za-z0-9._%+@-]+\/latest\.xpi$/u.test(extension.url)) {
      throw new Error("Zen extensions must use Mozilla's HTTPS latest.xpi URLs.");
    }
  }
  for (const preference of Object.values(value.preferences)) {
    if (!["boolean", "string", "number"].includes(typeof preference)
      || (typeof preference === "number" && !Number.isFinite(preference))) {
      throw new Error("Zen preference values must be strings, finite numbers, or booleans.");
    }
  }
  return value;
}

async function appearance(preferences: Settings["preferences"]): Promise<string[]> {
  const response = JSON.parse(run(["luna", "theme", "get", "--json"]));
  if (response.succes !== true) throw new Error("Luna could not resolve the current theme.");
  const theme = response.data as Theme;
  if (typeof theme.appearance?.rounding !== "number" || typeof theme.fonts?.ui !== "string"
    || typeof theme.fonts?.mono !== "string") throw new Error("Luna's resolved theme is missing fonts or rounding.");
  const square = theme.appearance.rounding === 0;
  const chromeTemplate = await Bun.file(new URL("userChrome.css", config)).text();
  const squareChrome = square ? await Bun.file(new URL("square-chrome.css", config)).text() : "";
  let chrome = "", cursor = 0;
  // Substitute only the original template; delimiters in a font name remain literal.
  while (true) {
    const start = chromeTemplate.indexOf("{{", cursor);
    if (start === -1) { chrome += chromeTemplate.slice(cursor); break; }
    const end = chromeTemplate.indexOf("}}", start + 2);
    if (end === -1) throw new Error("Unclosed Zen CSS theme token.");
    const token = chromeTemplate.slice(start + 2, end);
    const replacement = token === "ui_font" ? JSON.stringify(theme.fonts.ui)
      : token === "square_chrome" ? squareChrome
      : token.startsWith("colors.") ? theme.colors[token.slice(7)] : undefined;
    if (typeof replacement !== "string") throw new Error("Unknown or missing Zen theme token: " + token);
    chrome += chromeTemplate.slice(cursor, start) + replacement;
    cursor = end + 2;
  }
  const content = square ? await Bun.file(new URL("square-content.css", config)).text()
    : "/* Luna leaves website corner styles unchanged when rounding is enabled. */\n";
  const values = { ...preferences, "zen.theme.border-radius": square ? 0 : -1 };
  const groups = ["ar", "el", "he", "ja", "ko", "th", "x-armn", "x-beng", "x-cans", "x-cyrillic",
    "x-devanagari", "x-ethi", "x-geor", "x-gujr", "x-guru", "x-khmr", "x-knda", "x-mlym",
    "x-orya", "x-sinh", "x-tamil", "x-telu", "x-tibt", "x-unicode", "x-western", "zh-CN", "zh-HK", "zh-TW"];
  let user = "// Generated by Luna; rerun Zen's setup-profile.ts hook to refresh.\n";
  const preference = (name: string, value: string | number | boolean) => {
    user += "user_pref(" + JSON.stringify(name) + ", " + JSON.stringify(value) + ");\n";
  };
  for (const [name, value] of Object.entries(values)) preference(name, value);
  for (const group of groups) {
    preference("font.default." + group, "sans-serif");
    for (const [family, font] of [["serif", theme.fonts.ui], ["sans-serif", theme.fonts.ui], ["monospace", theme.fonts.mono]]) {
      preference("font.name." + family + "." + group, font);
    }
  }
  return [user, chrome, content];
}

async function lock(directory: string): Promise<() => Promise<void>> {
  const path = directory + "/.parentlock";
  checkPath(path);
  if (test("-e", path) && !test("-f", path)) throw new Error("Invalid Zen profile lock.");
  // OFD record locks conflict with Gecko's POSIX locks; ordinary flock does not.
  // Holding the keeper's stdin open retains the lock, including across downloads.
  const keeper = Bun.spawn(["flock", "--fcntl", "--exclusive", "--nonblock", "--", path,
    "sh", "-c", "printf 'locked\\n'; cat >/dev/null"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const reader = keeper.stdout.getReader();
  const ready = await reader.read();
  reader.releaseLock();
  if (ready.done || new TextDecoder().decode(ready.value).trim() !== "locked") {
    keeper.stdin.end();
    const detail = await new Response(keeper.stderr).text();
    await keeper.exited;
    throw new Error("Close Zen before configuring this profile; another setup may also hold its lock. " + detail.trim());
  }
  return async () => { keeper.stdin.end(); await keeper.exited; };
}

async function extensionPackage(extension: Extension, directory: string): Promise<Buffer> {
  const path = directory + "/" + extension.id + ".xpi";
  run(["curl", "--disable", "--fail", "--location", "--silent", "--show-error", "--globoff",
    "--proto", "=https", "--proto-redir", "=https", "--max-redirs", "5", "--connect-timeout", "15",
    "--max-time", "120", "--max-filesize", String(maxPackage), "--output", path, "--url", extension.url], 125_000);
  const data = await bytes(path);
  if (!data || data.length > maxPackage) throw new Error("Invalid or oversized Zen extension: " + extension.id);
  const entries = run(["unzip", "-l", "-qq", path]).split("\n").map(line => /^\s*(\d+)\s+\S+\s+\S+\s+(.+)$/u.exec(line));
  for (const name of ["manifest.json", "META-INF/manifest.mf", "META-INF/mozilla.sf", "META-INF/mozilla.rsa"]) {
    const matches = entries.filter(entry => entry?.[2] === name);
    if (matches.length !== 1 || Number(matches[0]![1]) < 1 || Number(matches[0]![1]) > maxManifest) {
      throw new Error("Zen extension must contain exactly one nonempty, bounded " + name);
    }
  }
  const child = Bun.spawn(["unzip", "-p", path, "manifest.json"], {
    stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 15_000,
  });
  const stderr = new Response(child.stderr).text();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of child.stdout) {
    size += chunk.length;
    if (size > maxManifest) { child.kill(); await child.exited; throw new Error("Zen extension manifest exceeds 1 MiB."); }
    chunks.push(chunk);
  }
  if (await child.exited !== 0) throw new Error("Cannot read Zen extension manifest: " + await stderr);
  const manifest = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const current = manifest.browser_specific_settings?.gecko?.id;
  const legacy = manifest.applications?.gecko?.id;
  if ((current ?? legacy) !== extension.id || (current && legacy && current !== legacy)) {
    throw new Error("Zen extension package does not declare " + extension.id);
  }
  // Presence checks are not cryptographic verification; Zen verifies signatures on startup.
  return data;
}

export async function setupProfile(explicit?: string): Promise<void> {
  if (process.getuid?.() === 0) throw new Error("Run Zen setup as your normal user, without sudo.");
  process.umask(0o077);
  const declared = await settings();
  const target = await profile(explicit);
  if (!target) {
    console.log("Skipped Zen: open it once, close it, then rerun its setup-profile.ts hook.");
    return;
  }
  const release = await lock(target.directory);
  let stage: string | undefined;
  try {
    const names = ["user.js", "chrome/userChrome.css", "chrome/userContent.css",
      ...declared.extensions.map(extension => "extensions/" + extension.id + ".xpi")];
    const files = await Promise.all(names.map(name => snapshot(target.directory + "/" + name)));
    const sources = [target.preferences, ...(target.registry ? [target.registry] : [])];
    for (const source of sources) await unchanged(source);
    const rendered: (string | Buffer)[] = await appearance(declared.preferences);
    stage = run(["mktemp", "-d", "--", "/tmp/luna-zen-XXXXXX"]);
    for (const extension of declared.extensions) rendered.push(await extensionPackage(extension, stage));
    for (const file of [...sources, ...files]) await unchanged(file);
    for (let index = 0; index < files.length; index++) await publish(files[index], rendered[index]);
    console.log(JSON.stringify({ profile: target.directory, extensions: declared.extensions.map(extension => extension.id) }));
  } finally {
    try {
      if (stage) {
        for (const extension of declared.extensions) run(["rm", "-f", "--", stage + "/" + extension.id + ".xpi"]);
        run(["rmdir", "--", stage]);
      }
    } finally {
      await release();
    }
  }
}

if (import.meta.main) {
  try {
    const args = Bun.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--profile" || !args[1])) {
      throw new Error("Usage: setup-profile.ts [--profile /absolute/path]");
    }
    await setupProfile(args[1]);
  } catch (error) {
    console.error("Configure Zen: " + (error as Error).message);
    process.exitCode = 1;
  }
}
