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
import { dirname, join } from "node:path";
import { Luna } from "../src/index.ts";

let root: string;
let config: string;
let env: Record<string, string>;
function write(path: string, source: string, executable = false) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source, { mode: executable ? 0o755 : 0o600 });
}
const options = () => ({ env });
function commands(): { args: string[]; settings?: string; theme?: string; launcher?: string }[] {
  return existsSync(env.LUNA_TEST_COMMANDS!)
    ? readFileSync(env.LUNA_TEST_COMMANDS!, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
}
const state = () => JSON.parse(readFileSync(env.LUNA_TEST_STATE!, "utf8"));
function change(patch: Record<string, unknown>) {
  write(env.LUNA_TEST_STATE!, JSON.stringify({ ...state(), ...patch }));
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "luna lock ' "));
  const bin = join(root, "bin");
  mkdirSync(bin);
  config = join(root, "config/luna/lock.jsonc");
  env = {
    HOME: root,
    PATH: bin,
    XDG_CONFIG_HOME: join(root, "config"),
    LUNA_TEST_COMMANDS: join(root, "commands.jsonl"),
    LUNA_TEST_STATE: join(root, "state.json"),
    LUNA_TEST_CONFIG: config,
    HYPRLAND_INSTANCE_SIGNATURE: "isolated-fixture",
  };
  for (const name of ["flock", "bash"]) symlinkSync(Bun.which(name)!, join(bin, name));
  write(join(root, "config/luna/lock/shell.qml"), "// fixture\n");
  write(join(root, ".local/bin/luna"), "#!/bin/sh\nexit 0\n", true);
  write(
    join(bin, "hyprctl"),
    `#!${process.execPath}
import { appendFileSync } from 'node:fs';
appendFileSync(Bun.env.LUNA_TEST_COMMANDS,JSON.stringify({args:['hyprctl',...Bun.argv.slice(2)]})+'\\n');
console.log(Bun.env.LUNA_TEST_POWER_ERROR?'error: fixture':'ok');
`,
    true,
  );
  write(
    join(bin, "qs"),
    `#!${process.execPath}
import {appendFileSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
const args=Bun.argv.slice(2);
appendFileSync(Bun.env.LUNA_TEST_COMMANDS,JSON.stringify({args,settings:Bun.env.LUNA_LOCK_SETTINGS,theme:Bun.env.LUNA_LOCK_THEME,launcher:Bun.env.LUNA_LOCK_COMMAND})+'\\n');
const file=Bun.env.LUNA_TEST_STATE;
let state=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{running:false};
if(args.includes('--daemonize'))state={running:true,status:'idle',settings:JSON.parse(Bun.env.LUNA_LOCK_SETTINGS)};
else if(args[0]==='ipc') {
  const marker=args.indexOf('--');
  if(args[marker+1]!=='lock')process.exit(2);
  if(state.stopping && --state.stopping===0)state.running=false;
  writeFileSync(file,JSON.stringify(state));
  if(!state.running)process.exit(1);
  const method=args[marker+2];
  if(method==='status'){
    if(state.pending && --state.pending===0)state.status='locked';
    console.log(state.status);
  }else if(method==='lock' || method==='lockIdle'){
    if(method==='lockIdle' && Bun.env.LUNA_TEST_STALE_IDLE)state.status='idle';
    else if(Bun.env.LUNA_TEST_REJECT_LOCK)state.status='idle';
    else {state.status='locking';state.pending=2;}
    console.log('ok');
  }else if(method==='stop'){
    if(Bun.env.LUNA_TEST_STOP_RACE)state.status='locking';
    if(state.status!=='idle')console.log('refused');
    else {state.stopping=2;console.log('ok');}
  }else if(method==='canPowerOff')console.log(state.status==='locked' && Bun.env.LUNA_TEST_POWER_IDLE==='1');
  else if(method==='snapshot')console.log(JSON.stringify(state.settings));
  else if(method==='reload') {
    const next=JSON.parse(args[marker+3]);
    if(next.dpms_seconds===13){
      if(Bun.env.LUNA_TEST_EXTERNAL)writeFileSync(Bun.env.LUNA_TEST_CONFIG,Bun.env.LUNA_TEST_EXTERNAL);
      console.log('error: rejected fixture reload');
    } else {state.settings=next;console.log('ok');}
  }else process.exit(3);
}else process.exit(4);
writeFileSync(file,JSON.stringify(state));
`,
    true,
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test("Lock reads sparse JSONC one-shot without saving defaults, and creates explicit missing paths", async () => {
  expect(await Luna.lock.get(undefined, options())).toEqual({ succes: true, data: {} });
  expect(readFileSync(config, "utf8")).toBe("{}\n");
  const source = '// author settings\n{"idle_seconds":0,"dpms_seconds":30,"future":null,}\n';
  write(config, source);
  expect(await Luna.lock.get("idle_seconds", options())).toEqual({ succes: true, data: 0 });
  expect(await Luna.lock.get("missing", options())).toEqual({ succes: true, data: null });
  expect(await Luna.lock.get("toString", options())).toEqual({ succes: true, data: null });
  expect(readFileSync(config, "utf8")).toBe(source);
  write(config, '{"idle_seconds":86400}');
  expect(await Luna.lock.get("idle_seconds", options())).toEqual({ succes: true, data: 86400 });
  const configFile = join(root, "explicit/settings.jsonc");
  expect(await Luna.lock.get(undefined, { configFile, env: {} })).toEqual({
    succes: true,
    data: {},
  });
  expect(await Luna.lock.getConfigFile({ env, configFile })).toEqual({
    succes: true,
    data: configFile,
  });
  expect(await Luna.lock.get("a..b", options())).toMatchObject({
    succes: false,
    err: "INVALID_ARGUMENT",
  });
  expect(commands()).toHaveLength(0);
});

test("invalid Lock timer values reject before writes or renderer control", async () => {
  for (const key of ["idle_seconds", "dpms_seconds"]) {
    for (const value of [-1, 86401, 1.5, true, "30", null]) {
      const source = JSON.stringify({ [key]: value });
      write(config, source);
      expect(await Luna.lock.get(undefined, options())).toMatchObject({
        succes: false,
        err: "INVALID_METADATA",
      });
      expect(await Luna.lock.configure({ [key]: value }, options())).toMatchObject({
        succes: false,
        err: "INVALID_ARGUMENT",
      });
      expect(readFileSync(config, "utf8")).toBe(source);
    }
  }
  for (const source of ["null", "[]", "bad JSONC"]) {
    write(config, source);
    expect(await Luna.lock.get(undefined, options())).toMatchObject({
      succes: false,
      err: "INVALID_METADATA",
    });
  }
  expect(commands()).toHaveLength(0);
});

test("Lock status works before shell installation; start validates it", async () => {
  rmSync(join(root, "config/luna/lock"), { recursive: true });
  expect(await Luna.lock.status(options())).toMatchObject({
    succes: true,
    data: { running: false, status: "stopped" },
  });
  expect(await Luna.lock.start(options())).toMatchObject({ succes: false, err: "INVALID_PATH" });
});

test("Lock lifecycle snapshots settings and theme; manual success waits for secure acknowledgement", async () => {
  write(config, '{"idle_seconds":0,"dpms_seconds":25}');
  expect(await Luna.lock.start(options())).toMatchObject({
    succes: true,
    data: { running: true, status: "idle" },
  });
  const started = commands().find((item) => item.args.includes("--daemonize"))!;
  expect(JSON.parse(started.settings!)).toEqual({ idle_seconds: 0, dpms_seconds: 25 });
  expect(JSON.parse(started.theme!)).toMatchObject({
    name: "tokyo-night",
    fonts: { ui: expect.any(String) },
  });
  expect(JSON.parse(started.launcher!)).toEqual([
    join(root, ".local/bin/luna"),
    "lock",
    "--config",
    config,
  ]);
  expect(env.LUNA_LOCK_SETTINGS).toBeUndefined();
  expect(await Luna.lock.lock(options())).toMatchObject({
    succes: true,
    data: { status: "locked" },
  });
  expect(state().pending).toBe(0);
  expect(await Luna.lock.start(options())).toMatchObject({
    succes: true,
    data: { status: "locked" },
  });
  expect(await Luna.lock.stop(options())).toMatchObject({ succes: false, err: "CONFLICT" });
  expect(await Luna.lock.restart(options())).toMatchObject({ succes: false, err: "CONFLICT" });
  expect(state().status).toBe("locked");
  expect(commands().some((item) => item.args[0] === "kill")).toBe(false);
  change({ status: "idle" });
  expect(await Luna.lock.restart(options())).toMatchObject({
    succes: true,
    data: { status: "idle" },
  });
  expect(commands().filter((item) => item.args.includes("--daemonize"))).toHaveLength(2);
  expect(await Luna.lock.stop(options())).toMatchObject({ succes: true, data: { running: false } });
  expect(await Luna.lock.stop(options())).toMatchObject({ succes: true, data: { running: false } });
  expect(await Luna.lock.reload(options())).toMatchObject({
    succes: true,
    data: { running: false },
  });
});

test("an auto-lock racing stop is refused by the shell; failed acquisition never kills the daemon", async () => {
  await Luna.lock.start(options());
  env.LUNA_TEST_STOP_RACE = "1";
  expect(await Luna.lock.stop(options())).toMatchObject({ succes: false, err: "CONFLICT" });
  expect(state().status).toBe("locking");
  delete env.LUNA_TEST_STOP_RACE;
  change({ status: "idle" });
  env.LUNA_TEST_REJECT_LOCK = "1";
  expect(await Luna.lock.open(options())).toMatchObject({ succes: false, err: "COMMAND_FAILED" });
  expect(state().running).toBe(true);
  env.LUNA_TEST_STALE_IDLE = "1";
  expect(await Luna.lock.lockIdle(options())).toMatchObject({
    succes: true,
    data: { status: "idle" },
  });
  expect(commands().some((item) => item.args[0] === "kill")).toBe(false);
});

test("Lock setting application preserves secure state and restores exact disk/active snapshots after failure", async () => {
  write(config, '// comments\n{"idle_seconds":0,"dpms_seconds":20,"future":true,}\n');
  await Luna.lock.lock(options());
  write(config, '// unreloaded edit\n{"idle_seconds":0,"dpms_seconds":50,"future":true}\n');
  const disk = readFileSync(config, "utf8");
  expect(await Luna.lock.configure({ dpms_seconds: 13 }, options())).toMatchObject({
    succes: false,
    err: "COMMAND_FAILED",
  });
  expect(readFileSync(config, "utf8")).toBe(disk);
  expect(state().settings.dpms_seconds).toBe(20);
  expect(state().status).toBe("locked");
  expect(await Luna.lock.configure({ dpms_seconds: 0 }, options())).toEqual({
    succes: true,
    data: { idle_seconds: 0, dpms_seconds: 0, future: true },
  });
  expect(state().settings.dpms_seconds).toBe(0);
  env.LUNA_TEST_EXTERNAL = '{"dpms_seconds":60}\n';
  expect(await Luna.lock.configure({ dpms_seconds: 13 }, options())).toMatchObject({
    succes: false,
    err: "CONFLICT",
  });
  expect(readFileSync(config, "utf8")).toBe(env.LUNA_TEST_EXTERNAL);
  expect(state().status).toBe("locked");
});

test("display off requires secure native idle; wake always runs and compositor errors propagate", async () => {
  await Luna.lock.start(options());
  env.LUNA_TEST_POWER_IDLE = "1";
  expect(await Luna.lock.display("off", options())).toMatchObject({
    succes: true,
    data: { status: "idle" },
  });
  await Luna.lock.lock(options());
  env.LUNA_TEST_POWER_IDLE = "0";
  await Luna.lock.display("off", options());
  expect(commands().filter((item) => item.args[0] === "hyprctl")).toHaveLength(0);
  env.LUNA_TEST_POWER_IDLE = "1";
  expect(await Luna.lock.display("off", options())).toMatchObject({
    succes: true,
    data: { status: "locked" },
  });
  expect(await Luna.lock.display("on", options())).toMatchObject({
    succes: true,
    data: { status: "locked" },
  });
  expect(
    commands()
      .filter((item) => item.args[0] === "hyprctl")
      .map((item) => item.args),
  ).toEqual([
    ["hyprctl", "dispatch", 'hl.dsp.dpms({ action = "disable" })'],
    ["hyprctl", "dispatch", 'hl.dsp.dpms({ action = "enable" })'],
  ]);
  env.LUNA_TEST_POWER_ERROR = "1";
  expect(await Luna.lock.display("on", options())).toMatchObject({
    succes: false,
    err: "COMMAND_FAILED",
  });
  expect(state().status).toBe("locked");
  delete env.HYPRLAND_INSTANCE_SIGNATURE;
  expect(await Luna.lock.display("on", options())).toMatchObject({
    succes: false,
    err: "INVALID_ENVIRONMENT",
  });
});

test("source shell, custom CLI and explicit paths survive idle command transport", async () => {
  const repository = join(root, "checkout");
  write(join(repository, "src/luna-lock/src/shell/shell.qml"), "// source");
  const launcher = join(root, "custom luna");
  write(launcher, "#!/bin/sh\nexit 0\n", true);
  const configFile = join(root, "personal/settings.jsonc");
  expect(await Luna.lock.start({ env, repository, configFile, launcher })).toMatchObject({
    succes: true,
    data: { configFile, shellDirectory: join(repository, "src/luna-lock/src/shell") },
  });
  const started = commands().find((item) => item.args.includes("--daemonize"))!;
  expect(JSON.parse(started.launcher!)).toEqual([
    launcher,
    "lock",
    "--config",
    configFile,
    "--install-dir",
    repository,
  ]);
});
