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
  const child = Bun.spawn([process.execPath, entry, "lock", "--config", configFile, ...args], {
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
  return readFileSync(env.LUNA_LOCK_TEST_LOG!, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "luna lock cli ' "));
  configFile = join(root, "settings/custom lock.jsonc");
  repository = join(root, "repository");
  env = {
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    PATH: join(root, "bin"),
    LUNA_LOCK_TEST_LOG: join(root, "commands.jsonl"),
    LUNA_LOCK_TEST_STATE: join(root, "renderer-state"),
    LUNA_LOCK_TEST_SNAPSHOT: join(root, "snapshot.json"),
    LUNA_LOCK_TEST_COMMAND: join(root, "idle-command.json"),
    LUNA_LOCK_TEST_POWER_LOG: join(root, "power.jsonl"),
    NO_COLOR: "1",
  };
  write(join(env.HOME!, ".local/bin/luna"), "#!/bin/sh\nexit 0\n", true);
  write(env.LUNA_LOCK_TEST_LOG!, "");
  mkdirSync(env.PATH!, { recursive: true });
  for (const tool of ["flock", "bash"]) symlinkSync(Bun.which(tool)!, join(env.PATH!, tool));
  write(configFile, '// Keep sparse settings\n{"idle_seconds":180,"dpms_seconds":20,}\n');
  write(join(env.XDG_CONFIG_HOME!, "luna/lock/shell.qml"), "import Quickshell\nShellRoot {}");
  write(join(repository, "src/luna-lock/src/shell/shell.qml"), "import Quickshell\nShellRoot {}");
  write(
    join(env.PATH!, "qs"),
    `#!${process.execPath}\n` +
      `import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";\n` +
      `const args = Bun.argv.slice(2);\n` +
      `appendFileSync(process.env.LUNA_LOCK_TEST_LOG, JSON.stringify(args) + "\\n");\n` +
      `const state = process.env.LUNA_LOCK_TEST_STATE;\n` +
      `const snapshot = process.env.LUNA_LOCK_TEST_SNAPSHOT;\n` +
      `if (args[0] === "ipc") {\n` +
      `  if (!existsSync(state)) process.exit(1);\n` +
      `  const method = args[args.indexOf("lock") + 1];\n` +
      `  if (method === "status") console.log(readFileSync(state, "utf8"));\n` +
      `  else if (method === "snapshot") console.log(existsSync(snapshot) ? readFileSync(snapshot, "utf8") : "{}");\n` +
      `  else if (method === "reload") { writeFileSync(snapshot, args[args.indexOf("lock") + 2]); console.log("ok"); }\n` +
      `  else if (method === "lock" || method === "lockIdle") { writeFileSync(state, "locked"); console.log("ok"); }\n` +
      `  else if (method === "stop") { if (readFileSync(state, "utf8") === "idle") { unlinkSync(state); console.log("ok"); } else console.log("locked"); }\n` +
      `  else if (method === "canPowerOff") console.log(process.env.LUNA_LOCK_TEST_IDLE === "1" ? "true" : "false");\n` +
      `  else process.exit(9);\n` +
      `} else if (args[0] === "kill") { if (existsSync(state)) unlinkSync(state); }\n` +
      `else if (args.includes("--daemonize")) {\n` +
      `  writeFileSync(state, "idle");\n` +
      `  writeFileSync(snapshot, process.env.LUNA_LOCK_SETTINGS);\n` +
      `  writeFileSync(process.env.LUNA_LOCK_TEST_COMMAND, process.env.LUNA_LOCK_COMMAND);\n` +
      `} else process.exit(9);\n`,
    true,
  );
  write(
    join(env.PATH!, "hyprctl"),
    `#!${process.execPath}\nimport { appendFileSync } from "node:fs";\n` +
      `appendFileSync(process.env.LUNA_LOCK_TEST_POWER_LOG, JSON.stringify(Bun.argv.slice(2)) + "\\n");\n` +
      `console.log("ok");\n`,
    true,
  );
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

test("lock reads sparse JSONC and explicit paths without Quickshell", async () => {
  env.PATH = join(root, "no-tools");
  const result = await cli(["get", "--json"]);
  expect(result.exitCode, result.stdout + result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual({
    succes: true,
    data: { idle_seconds: 180, dpms_seconds: 20 },
  });
  expect((await cli(["get", "idle_seconds"])).stdout).toBe("180\n");
  expect(JSON.parse((await cli(["get", "missing", "--json"])).stdout)).toEqual({
    succes: true,
    data: null,
  });
  expect((await cli(["get-config-file"])).stdout).toBe(`${configFile}\n`);
  expect(commands()).toEqual([]);
});

test("lock starts idle, secures bare/open requests, and refuses stopping or restarting an active lock", async () => {
  const selected = ["--install-dir", repository];
  expect((await cli([...selected, "status"])).stdout).toBe("Lock: stopped\n");
  const start = await cli([...selected, "start", "--json"]);
  expect(start.exitCode, start.stdout + start.stderr).toBe(0);
  expect(JSON.parse(start.stdout)).toEqual({
    succes: true,
    data: {
      running: true,
      status: "idle",
      shellDirectory: join(repository, "src/luna-lock/src/shell"),
      configFile,
    },
  });
  expect((await cli([...selected, "reload"])).stdout).toBe("Lock: idle\n");
  expect((await cli([...selected, "restart"])).stdout).toBe("Lock: idle\n");
  expect((await cli([...selected])).stdout).toBe("Lock: locked\n");
  expect((await cli([...selected, "open"])).stdout).toBe("Lock: locked\n");
  for (const action of ["stop", "restart"]) {
    const result = await cli([...selected, action, "--json"]);
    expect(result.exitCode, result.stdout + result.stderr).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ succes: false, err: "CONFLICT" });
  }
  // Only the isolated renderer fixture simulates a successful authenticated unlock.
  write(env.LUNA_LOCK_TEST_STATE!, "idle");
  expect((await cli([...selected, "stop"])).stdout).toBe("Lock: stopped\n");
  expect(commands().filter((args) => args.includes("--daemonize"))).toHaveLength(2);
  expect(commands().filter((args) => args[0] === "kill")).toHaveLength(0);
});

test("lock settings apply through the API and independently disable idle and display timers", async () => {
  write(env.LUNA_LOCK_TEST_STATE!, "idle");
  write(env.LUNA_LOCK_TEST_SNAPSHOT!, '{"idle_seconds":180,"dpms_seconds":20}');
  const updated = await cli(["set-idle", "0"]);
  expect(updated.exitCode, updated.stdout + updated.stderr).toBe(0);
  expect(updated.stdout).toBe("Lock updated.\n");
  expect(Bun.JSONC.parse(readFileSync(configFile, "utf8"))).toEqual({
    idle_seconds: 0,
    dpms_seconds: 20,
  });
  expect(JSON.parse(readFileSync(env.LUNA_LOCK_TEST_SNAPSHOT!, "utf8"))).toEqual({
    idle_seconds: 0,
    dpms_seconds: 20,
  });
  expect(commands().filter((args) => args.includes("reload"))).toHaveLength(1);
  const dpms = await cli(["set-dpms", "0", "--json"]);
  expect(dpms.exitCode, dpms.stdout + dpms.stderr).toBe(0);
  expect(JSON.parse(dpms.stdout)).toEqual({
    succes: true,
    data: { idle_seconds: 0, dpms_seconds: 0 },
  });
  expect(JSON.parse(readFileSync(env.LUNA_LOCK_TEST_SNAPSHOT!, "utf8"))).toEqual({
    idle_seconds: 0,
    dpms_seconds: 0,
  });
  expect(commands().some((args) => args[0] === "kill")).toBe(false);
});

test("lock passes a custom launcher and source/config paths to idle activation", async () => {
  const launcher = join(root, "custom bin/luna");
  write(launcher, "#!/bin/sh\nexit 0\n", true);
  const result = await cli(["--install-dir", repository, "--launcher", launcher, "start"]);
  expect(result.exitCode, result.stdout + result.stderr).toBe(0);
  expect(JSON.parse(readFileSync(env.LUNA_LOCK_TEST_COMMAND!, "utf8"))).toEqual([
    launcher,
    "lock",
    "--config",
    configFile,
    "--install-dir",
    repository,
  ]);
});

test("lock rejects malformed arguments and invalid durations before touching settings", async () => {
  const original = readFileSync(configFile, "utf8");
  for (const args of [
    ["set-idle"],
    ["set-idle", "300s"],
    ["set-idle", "Infinity"],
    ["set-dpms", "wat"],
    ["display", "maybe"],
    ["unlock"],
  ]) {
    const result = await cli([...args, "--json"]);
    expect(result.exitCode, result.stdout + result.stderr).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({ succes: false, err: "INVALID_ARGUMENT" });
  }
  for (const command of ["set-idle", "set-dpms"])
    for (const value of ["-1", "0.5", "86401"]) {
      const result = await cli([command, value, "--json"]);
      expect(result.exitCode, result.stdout + result.stderr).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ succes: false, err: "INVALID_ARGUMENT" });
    }
  expect(readFileSync(configFile, "utf8")).toBe(original);
  expect(commands()).toEqual([]);
});

test("lock routes display events through the API, rechecks idle intent, and exposes no unlock command", async () => {
  write(env.LUNA_LOCK_TEST_STATE!, "locked");
  env.HYPRLAND_INSTANCE_SIGNATURE = "isolated-test";
  env.LUNA_LOCK_TEST_IDLE = "1";
  const off = await cli(["display", "off", "--json"]);
  expect(off.exitCode, off.stdout + off.stderr).toBe(0);
  expect(JSON.parse(off.stdout)).toMatchObject({ succes: true, data: { status: "locked" } });
  env.LUNA_LOCK_TEST_IDLE = "0";
  const stale = await cli(["display", "off", "--json"]);
  expect(stale.exitCode, stale.stdout + stale.stderr).toBe(0);
  const on = await cli(["display", "on", "--json"]);
  expect(on.exitCode, on.stdout + on.stderr).toBe(0);
  const power = readFileSync(env.LUNA_LOCK_TEST_POWER_LOG!, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(power).toEqual([
    ["dispatch", 'hl.dsp.dpms({ action = "disable" })'],
    ["dispatch", 'hl.dsp.dpms({ action = "enable" })'],
  ]);
  expect(readFileSync(env.LUNA_LOCK_TEST_STATE!, "utf8")).toBe("locked");
  const help = await cli(["--help"]);
  expect(help.exitCode).toBe(0);
  expect(help.stdout).not.toContain("lock-idle");
  expect(help.stdout).not.toContain("display <state>");
  expect(help.stdout).not.toContain("unlock");
});
