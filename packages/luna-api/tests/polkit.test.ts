import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Luna } from "../src/index.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "luna polkit ' "));
  roots.push(root);
  const config = join(root, "config/luna");
  mkdirSync(join(config, "polkit"), { recursive: true });
  writeFileSync(join(config, "polkit/shell.qml"), "// fixture");
  mkdirSync(join(root, "bin"));
  const stateFile = join(root, "state");
  const log = join(root, "commands");
  const qs = join(root, "bin/qs");
  writeFileSync(
    qs,
    `#!${process.execPath}
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
const args=Bun.argv.slice(2), file=Bun.env.POLKIT_TEST_STATE;
appendFileSync(Bun.env.POLKIT_TEST_LOG, JSON.stringify(args)+'\\n');
let state=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{status:'stopped'};
if(args[0]==='ipc') {
  if(state.status==='stopped')process.exit(1);
  console.log(state.status);
} else if(args[0]==='kill')state.status='stopped';
else if(Bun.env.LUNA_POLKIT_VALIDATE==='1') {
  if(Bun.env.POLKIT_TEST_INVALID)process.exit(5);
  console.log('Luna polkit validation passed');
} else if(args.includes('--daemonize')) {
  state={status:Bun.env.POLKIT_TEST_CONFLICT?'stopped':'running', settings:JSON.parse(Bun.env.LUNA_POLKIT_SETTINGS), theme:JSON.parse(Bun.env.LUNA_POLKIT_THEME)};
} else process.exit(3);
writeFileSync(file,JSON.stringify(state));
`,
  );
  chmodSync(qs, 0o755);
  return {
    root,
    config,
    configFile: join(config, "polkit.jsonc"),
    state: () => JSON.parse(readFileSync(stateFile, "utf8")),
    commands: () =>
      readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]),
    env: {
      HOME: root,
      PATH: join(root, "bin") + ":/usr/bin",
      XDG_CONFIG_HOME: join(root, "config"),
      POLKIT_TEST_STATE: stateFile,
      POLKIT_TEST_LOG: log,
    },
  };
}

test("polkit lifecycle validates before replacing, confirms registration, scopes commands and is idempotent", async () => {
  const f = fixture();
  expect(await Luna.polkit.status({ env: f.env })).toMatchObject({
    succes: true,
    data: { status: "stopped" },
  });
  const source = '// Personal settings\n{"width":480}';
  writeFileSync(f.configFile, source);
  expect(await Luna.polkit.start({ env: f.env })).toMatchObject({
    succes: true,
    data: { running: true, status: "running" },
  });
  expect(f.state().settings).toEqual({ width: 480, dim_opacity: 0.5 });
  expect(f.state().theme.fonts.ui).toBeTruthy();
  await Luna.polkit.start({ env: f.env });
  expect(f.commands().filter((args) => args.includes("--daemonize"))).toHaveLength(1);
  expect(readFileSync(f.configFile, "utf8")).toBe(source);
  expect(await Luna.polkit.restart({ env: { ...f.env, POLKIT_TEST_INVALID: "1" } })).toMatchObject({
    succes: false,
    err: "COMMAND_FAILED",
  });
  expect(f.state().status).toBe("running");
  expect(f.commands().some((args) => args[0] === "kill")).toBe(false);
  writeFileSync(f.configFile, '{"width":1}');
  expect(await Luna.polkit.restart({ env: f.env })).toMatchObject({
    succes: false,
    err: "INVALID_METADATA",
  });
  expect(f.commands().some((args) => args[0] === "kill")).toBe(false);
  writeFileSync(f.configFile, "{}");
  expect(await Luna.polkit.restart({ env: f.env })).toMatchObject({
    succes: true,
    data: { running: true },
  });
  expect(f.state().settings.width).toBe(420);
  for (const args of f.commands()) expect(args).toContain(join(f.config, "polkit"));
  expect(await Luna.polkit.stop({ env: f.env })).toMatchObject({
    succes: true,
    data: { status: "stopped" },
  });
  expect(await Luna.polkit.stop({ env: f.env })).toMatchObject({
    succes: true,
    data: { status: "stopped" },
  });
});

test("failed registration reports failure without targeting another agent", async () => {
  const f = fixture();
  expect(await Luna.polkit.start({ env: { ...f.env, POLKIT_TEST_CONFLICT: "1" } })).toMatchObject({
    succes: false,
    err: "COMMAND_FAILED",
  });
  expect(f.state().status).toBe("stopped");
  expect(f.commands().every((args) => args.includes(join(f.config, "polkit")))).toBe(true);
});

test("settings honor explicit paths, create missing JSONC and preserve missing keys without Quickshell", async () => {
  const f = fixture();
  const env = { ...f.env, PATH: "", LUNA_POLKIT_CONFIG: join(f.root, "env.jsonc") };
  const configFile = join(f.root, "custom/settings.jsonc");
  expect(await Luna.polkit.getConfigFile({ env })).toEqual({
    succes: true,
    data: env.LUNA_POLKIT_CONFIG,
  });
  expect(await Luna.polkit.getConfigFile({ env, configFile })).toEqual({
    succes: true,
    data: configFile,
  });
  expect(await Luna.polkit.get(undefined, { env, configFile })).toEqual({ succes: true, data: {} });
  expect(await Luna.polkit.get("width", { env, configFile })).toEqual({ succes: true, data: null });
  expect(Bun.JSONC.parse(readFileSync(configFile, "utf8"))).toEqual({});
  expect(await Luna.polkit.get("a..b", { env, configFile })).toMatchObject({
    succes: false,
    err: "INVALID_ARGUMENT",
  });
  expect(await Luna.polkit.getConfigFile({ env, configFile: "" })).toMatchObject({
    succes: false,
    err: "INVALID_PATH",
  });
});

test("CLI exposes lifecycle and settings with JSON output and explicit source paths", () => {
  const f = fixture();
  const repository = join(f.root, "checkout");
  mkdirSync(join(repository, "src/luna-polkit/src/shell"), { recursive: true });
  writeFileSync(join(repository, "src/luna-polkit/src/shell/shell.qml"), "// fixture");
  const cli = new URL("../../../src/luna-cli/src/index.ts", import.meta.url).pathname;
  for (const action of ["start", "status", "restart", "stop"]) {
    const result = Bun.spawnSync(
      [
        process.execPath,
        cli,
        "--json",
        "polkit",
        "--install-dir",
        repository,
        "--config",
        f.configFile,
        action,
      ],
      { env: f.env },
    );
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toMatchObject({
      succes: true,
      data: { status: action === "stop" ? "stopped" : "running", configFile: f.configFile },
    });
  }
  const help = Bun.spawnSync([process.execPath, cli, "polkit", "--help"], { env: f.env });
  expect(help.exitCode).toBe(0);
  expect(help.stdout.toString()).not.toContain("submit");
});
