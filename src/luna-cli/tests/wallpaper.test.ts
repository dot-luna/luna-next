import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const entry = resolve(import.meta.dir, "../src/index.ts");
let root: string;
let configFile: string;
let repository: string;
let libraryDir: string;
let env: Record<string, string>;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII=",
  "base64",
);

function write(path: string, contents: string, executable = false) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, { mode: executable ? 0o755 : 0o644 });
}

function image(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
  return path;
}

async function cli(args: string[]) {
  const child = Bun.spawn([process.execPath, entry, "wallpaper", "--config", configFile, ...args], {
    cwd: root,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function commands(): string[][] {
  return readFileSync(env.LUNA_WALLPAPER_TEST_LOG!, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "luna wallpaper cli ' "));
  configFile = join(root, "settings/custom wallpaper.jsonc");
  repository = join(root, "repository");
  env = {
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    PATH: join(root, "bin"),
    LUNA_WALLPAPER_TEST_LOG: join(root, "commands.jsonl"),
    LUNA_WALLPAPER_TEST_STATE: join(root, "renderer-state"),
    LUNA_WALLPAPER_TEST_SNAPSHOT: join(root, "snapshot.json"),
    NO_COLOR: "1",
  };
  libraryDir = join(env.XDG_DATA_HOME!, "luna/wallpapers");
  write(join(env.HOME!, ".keep"), "");
  write(env.LUNA_WALLPAPER_TEST_LOG!, "");
  mkdirSync(env.PATH!, { recursive: true });
  for (const tool of ["flock", "bash", "file", "curl"])
    symlinkSync(Bun.which(tool)!, join(env.PATH!, tool));
  write(configFile, '// Keep my settings\n{"wallpaper":{"fit":"fit"},}\n');
  write(join(env.XDG_CONFIG_HOME!, "luna/wallpaper/shell.qml"), "import Quickshell\nShellRoot {}");
  write(
    join(repository, "src/luna-wallpaper/src/shell/shell.qml"),
    "import Quickshell\nShellRoot {}",
  );
  write(
    join(env.PATH!, "qs"),
    `#!${process.execPath}\n` +
      `import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";\n` +
      `const args = Bun.argv.slice(2);\n` +
      `appendFileSync(process.env.LUNA_WALLPAPER_TEST_LOG, JSON.stringify(args) + "\\n");\n` +
      `const state = process.env.LUNA_WALLPAPER_TEST_STATE;\n` +
      `const snapshot = process.env.LUNA_WALLPAPER_TEST_SNAPSHOT;\n` +
      `if (args[0] === "ipc") {\n` +
      `  if (!existsSync(state)) process.exit(1);\n` +
      `  const method = args[args.indexOf("wallpaper") + 1];\n` +
      `  if (method === "status") console.log(readFileSync(state, "utf8"));\n` +
      `  else if (method === "snapshot") console.log(existsSync(snapshot) ? readFileSync(snapshot, "utf8") : "{}");\n` +
      `  else if (method === "reload") { writeFileSync(snapshot, args.at(-1)); console.log("ok"); }\n` +
      `  else process.exit(9);\n` +
      `} else if (args[0] === "kill") { if (existsSync(state)) unlinkSync(state); }\n` +
      `else if (args.includes("--daemonize")) {\n` +
      `  writeFileSync(state, "ready");\n` +
      `  writeFileSync(snapshot, process.env.LUNA_WALLPAPER_SETTINGS);\n` +
      `} else process.exit(9);\n`,
    true,
  );
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

test("wallpaper reads JSONC and locates explicit configuration without Quickshell", async () => {
  env.PATH = join(root, "no-tools");
  const result = await cli(["get", "--json"]);
  expect(result.exitCode, result.stdout + result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual({
    succes: true,
    data: { wallpaper: { fit: "fit" } },
  });
  expect((await cli(["get", "wallpaper.fit"])).stdout).toBe("fit\n");
  const missing = await cli(["get", "wallpaper.missing", "--json"]);
  expect(JSON.parse(missing.stdout)).toEqual({ succes: true, data: null });
  expect((await cli(["get-config-file"])).stdout).toBe(`${configFile}\n`);
  expect(commands()).toEqual([]);
});

test("wallpaper setters preserve sparse JSONC and send validated settings to the renderer", async () => {
  write(env.LUNA_WALLPAPER_TEST_STATE!, "ready");
  const source = join(root, 'wallpaper " spaces ;$(touch forbidden).png');
  write(source, "fixture media");
  const set = await cli(["set", source, "--json"]);
  expect(set.exitCode, set.stdout + set.stderr).toBe(0);
  expect(set.stderr).toBe("");
  expect(JSON.parse(set.stdout).succes).toBe(true);
  const initial = Bun.JSONC.parse(readFileSync(configFile, "utf8"));
  expect(initial).toEqual({ wallpaper: { fit: "fit", source } });

  for (const args of [
    ["fit", "center"],
    ["background", "#102030"],
    ["pause-when-inactive", "false"],
    ["transition", "none", "250"],
  ]) {
    const result = await cli(args);
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toBe("Wallpaper updated.\n");
  }
  expect(Bun.JSONC.parse(readFileSync(configFile, "utf8"))).toEqual({
    wallpaper: { fit: "center", source, background_color: "#102030" },
    playback: { pause_when_output_inactive: false },
    transition: { type: "none", duration_ms: 250 },
  });
  expect(JSON.parse(readFileSync(env.LUNA_WALLPAPER_TEST_SNAPSHOT!, "utf8"))).toMatchObject({
    wallpaper: { source, fit: "center", background_color: "#102030" },
    playback: { pause_when_output_inactive: false },
    transition: { type: "none", duration_ms: 250 },
  });
  expect(commands().filter((args) => args.includes("reload"))).toHaveLength(5);

  const cleared = await cli(["set", "", "--json"]);
  expect(cleared.exitCode, cleared.stdout + cleared.stderr).toBe(0);
  expect(Bun.JSONC.parse(readFileSync(configFile, "utf8"))).toMatchObject({
    wallpaper: { source: "" },
  });
});

test("wallpaper lifecycle commands select source QML and report renderer state", async () => {
  const selected = ["--install-dir", repository];
  expect((await cli([...selected])).stdout).toBe("Wallpaper: stopped\n");
  for (const action of ["start", "reload", "restart"] as const) {
    const result = await cli([...selected, action, "--json"]);
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      succes: true,
      data: {
        running: true,
        status: "ready",
        shellDirectory: join(repository, "src/luna-wallpaper/src/shell"),
        configFile,
      },
    });
  }
  expect((await cli([...selected, "status"])).stdout).toBe("Wallpaper: ready\n");
  expect((await cli([...selected, "stop"])).stdout).toBe("Wallpaper: stopped\n");
  expect(commands().filter((args) => args.includes("--daemonize"))).toHaveLength(2);
  expect(commands().filter((args) => args[0] === "kill")).toHaveLength(2);
});

test("wallpaper CLI installs stable copies and selects them by name", async () => {
  const source = image(join(root, "downloads/original.png"));
  const selectedLibrary = join(root, "custom library");
  const flags = ["--library-dir", selectedLibrary];
  const installed = join(selectedLibrary, "my wallpaper.png");
  const install = await cli([...flags, "add", source, "--name", "my wallpaper.png", "--json"]);
  expect(install.exitCode, install.stdout + install.stderr).toBe(0);
  expect(install.stderr).toBe("");
  expect(JSON.parse(install.stdout)).toEqual({
    succes: true,
    data: [{ name: "my wallpaper.png", path: installed, current: false }],
  });
  expect(readFileSync(installed)).toEqual(png);
  rmSync(source);
  expect((await cli([...flags, "dir"])).stdout).toBe(`${selectedLibrary}\n`);
  expect((await cli([...flags, "path", "my wallpaper.png"])).stdout).toBe(`${installed}\n`);
  expect(JSON.parse((await cli([...flags, "current", "--json"])).stdout)).toEqual({
    succes: true,
    data: null,
  });

  write(env.LUNA_WALLPAPER_TEST_STATE!, "ready");
  const selected = await cli([...flags, "set", "my wallpaper.png", "--json"]);
  expect(selected.exitCode, selected.stdout + selected.stderr).toBe(0);
  expect(Bun.JSONC.parse(readFileSync(configFile, "utf8"))).toMatchObject({
    wallpaper: { source: installed },
  });
  expect(JSON.parse(readFileSync(env.LUNA_WALLPAPER_TEST_SNAPSHOT!, "utf8"))).toMatchObject({
    wallpaper: { source: installed },
  });
  expect((await cli([...flags, "current"])).stdout).toBe(`${installed}\n`);
  expect((await cli([...flags, "list"])).stdout).toBe("* my wallpaper.png\n");
  expect(JSON.parse((await cli([...flags, "list", "--json"])).stdout)).toEqual({
    succes: true,
    data: [{ name: "my wallpaper.png", path: installed, current: true }],
  });
});

test("wallpaper CLI imports multiple files and folders with optional recursion", async () => {
  const folder = join(root, "folder");
  image(join(folder, "first.png"));
  image(join(folder, "nested/second.png"));
  write(join(folder, "notes.txt"), "not media");
  const other = image(join(root, "third.png"));
  const install = await cli(["install", folder, other, "--json"]);
  expect(install.exitCode, install.stdout + install.stderr).toBe(0);
  expect(JSON.parse(install.stdout).data.map((entry: { name: string }) => entry.name)).toEqual([
    "first.png",
    "third.png",
  ]);
  expect(existsSync(join(libraryDir, "second.png"))).toBe(false);
  expect(existsSync(join(libraryDir, "notes.txt"))).toBe(false);

  const recursiveLibrary = join(root, "recursive library");
  const recursive = await cli([
    "--library-dir",
    recursiveLibrary,
    "install",
    folder,
    "-r",
    "--json",
  ]);
  expect(recursive.exitCode, recursive.stdout + recursive.stderr).toBe(0);
  expect(JSON.parse(recursive.stdout).data.map((entry: { name: string }) => entry.name)).toEqual([
    "first.png",
    "second.png",
  ]);
  expect(readFileSync(join(recursiveLibrary, "second.png"))).toEqual(png);
});

test("wallpaper CLI downloads URLs and preserves installed files on conflicts", async () => {
  let contents = png;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(contents, { headers: { "Content-Type": "image/png" } }),
  });
  try {
    const url = new URL("remote%20wallpaper.png", server.url).href;
    const install = await cli(["install", url, "--json"]);
    expect(install.exitCode, install.stdout + install.stderr).toBe(0);
    const installed = join(libraryDir, "remote wallpaper.png");
    expect(readFileSync(installed)).toEqual(png);
    expect((await cli(["install", url, "--json"])).exitCode).toBe(0);
    contents = Buffer.concat([png, Buffer.from("different media content")]);
    const conflict = await cli(["install", url, "--json"]);
    expect(conflict.exitCode).toBe(1);
    expect(JSON.parse(conflict.stdout)).toMatchObject({ succes: false });
    expect(readFileSync(installed)).toEqual(png);
  } finally {
    server.stop(true);
  }
});

test("wallpaper removal requires confirmation, previews paths and protects selected or playing media", async () => {
  const source = image(join(root, "one.png"));
  expect((await cli(["install", source, "--json"])).exitCode).toBe(0);
  const installed = join(libraryDir, "one.png");
  const confirm = await cli(["remove", "one.png", "--json"]);
  expect(confirm.exitCode).toBe(1);
  expect(confirm.stderr).toBe("");
  expect(JSON.parse(confirm.stdout)).toMatchObject({ succes: false, err: "INPUT_REQUIRED" });
  const preview = await cli(["remove", "one.png", "--dry-run", "--json"]);
  expect(preview.exitCode, preview.stdout + preview.stderr).toBe(0);
  expect(JSON.parse(preview.stdout)).toEqual({ succes: true, data: [installed] });
  expect(existsSync(installed)).toBe(true);

  write(env.LUNA_WALLPAPER_TEST_STATE!, "ready");
  expect((await cli(["set", "one.png", "--json"])).exitCode).toBe(0);
  const selected = await cli(["remove", "one.png", "--yes", "--json"]);
  expect(selected.exitCode).toBe(1);
  expect(existsSync(installed)).toBe(true);
  write(configFile, '{"wallpaper":{"source":""}}\n');
  const playing = await cli(["remove", "one.png", "--yes", "--json"]);
  expect(playing.exitCode).toBe(1);
  expect(existsSync(installed)).toBe(true);

  expect((await cli(["set", "", "--json"])).exitCode).toBe(0);
  const removed = await cli(["remove", "one.png", "--yes", "--json"]);
  expect(removed.exitCode, removed.stdout + removed.stderr).toBe(0);
  expect(JSON.parse(removed.stdout)).toEqual({ succes: true, data: [installed] });
  expect(existsSync(installed)).toBe(false);
});

test("wallpaper random selects another managed copy and rejects an empty library", async () => {
  const empty = await cli(["random", "--json"]);
  expect(empty.exitCode).toBe(1);
  expect(JSON.parse(empty.stdout)).toMatchObject({ succes: false });
  const first = image(join(root, "first.png"));
  const second = image(join(root, "second.png"));
  expect((await cli(["install", first, second, "--json"])).exitCode).toBe(0);
  expect((await cli(["set", "first.png", "--json"])).exitCode).toBe(0);
  const random = await cli(["random", "--json"]);
  expect(random.exitCode, random.stdout + random.stderr).toBe(0);
  expect((await cli(["current"])).stdout).toBe(`${join(libraryDir, "second.png")}\n`);
});

test("wallpaper install rejects invalid names and ambiguous renames without importing", async () => {
  const first = image(join(root, "first.png"));
  const second = image(join(root, "second.png"));
  for (const args of [
    ["install", first, "--name", "../escape.png"],
    ["install", first, second, "--name", "both.png"],
  ]) {
    const result = await cli([...args, "--json"]);
    expect(result.exitCode, result.stdout + result.stderr).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ succes: false });
  }
  expect(existsSync(join(root, "escape.png"))).toBe(false);
  expect((await cli(["list"])).stdout).toBe("\n");
});

test("wallpaper rejects invalid arguments and settings before changing the configuration", async () => {
  const original = readFileSync(configFile, "utf8");
  for (const args of [["set"], ["pause-when-inactive", "yes"], ["transition", "fade", "250ms"]]) {
    const result = await cli([...args, "--json"]);
    expect(result.exitCode, result.stdout + result.stderr).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({ succes: false, err: "INVALID_ARGUMENT" });
  }
  for (const args of [
    ["set", "relative.png"],
    ["fit", "invalid"],
    ["background", "invalid"],
    ["transition", "invalid"],
  ]) {
    const result = await cli([...args, "--json"]);
    expect(result.exitCode, result.stdout + result.stderr).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({ succes: false });
  }
  expect(readFileSync(configFile, "utf8")).toBe(original);
  expect(commands()).toEqual([]);
});
