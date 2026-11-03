import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const entry = resolve(import.meta.dir, "../src/index.ts");
let root: string;
let configFile: string;
let repository: string;
let env: Record<string, string>;

function write(path: string, contents: string, executable = false) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, { mode: executable ? 0o755 : 0o644 });
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
    PATH: join(root, "bin"),
    LUNA_WALLPAPER_TEST_LOG: join(root, "commands.jsonl"),
    LUNA_WALLPAPER_TEST_STATE: join(root, "renderer-state"),
    LUNA_WALLPAPER_TEST_SNAPSHOT: join(root, "snapshot.json"),
    NO_COLOR: "1",
  };
  write(join(env.HOME!, ".keep"), "");
  write(env.LUNA_WALLPAPER_TEST_LOG!, "");
  mkdirSync(env.PATH!, { recursive: true });
  for (const tool of ["flock", "bash"]) symlinkSync(Bun.which(tool)!, join(env.PATH!, tool));
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
