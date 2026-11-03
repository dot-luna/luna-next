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
function options() {
  return { env };
}
function commands(): { args: string[]; settings?: string; theme?: string; launcher?: string }[] {
  return existsSync(env.LUNA_TEST_COMMANDS!)
    ? readFileSync(env.LUNA_TEST_COMMANDS!, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
}
function state() {
  return JSON.parse(readFileSync(env.LUNA_TEST_STATE!, "utf8"));
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "luna saver ' "));
  const bin = join(root, "bin");
  mkdirSync(bin);
  config = join(root, "config/luna/screensaver.jsonc");
  env = {
    HOME: root,
    PATH: bin,
    XDG_CONFIG_HOME: join(root, "config"),
    LUNA_TEST_COMMANDS: join(root, "commands.jsonl"),
    LUNA_TEST_STATE: join(root, "state.json"),
    LUNA_TEST_CONFIG: config,
  };
  for (const name of ["flock", "bash"]) symlinkSync(Bun.which(name)!, join(bin, name));
  write(join(root, "config/luna/screensaver/shell.qml"), "// fixture\n");
  write(join(root, ".local/bin/luna"), "#!/bin/sh\nexit 0\n", true);
  write(
    join(bin, "hyprctl"),
    `#!${process.execPath}\nconsole.log(Bun.env.LUNA_TEST_LOCKED==='invalid'?'bad JSON':JSON.stringify({locked:Bun.env.LUNA_TEST_LOCKED==='1'}));\n`,
    true,
  );
  write(
    join(bin, "qs"),
    `#!${process.execPath}
import {appendFileSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
const args=Bun.argv.slice(2);
appendFileSync(Bun.env.LUNA_TEST_COMMANDS,JSON.stringify({args,settings:Bun.env.LUNA_SCREENSAVER_SETTINGS,theme:Bun.env.LUNA_SCREENSAVER_THEME,launcher:Bun.env.LUNA_SCREENSAVER_COMMAND})+'\\n');
const file=Bun.env.LUNA_TEST_STATE;
let state=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{running:false};
if(args.includes('--daemonize'))state={running:true,visible:false,settings:JSON.parse(Bun.env.LUNA_SCREENSAVER_SETTINGS)};
else if(args[0]==='kill')state.stopping=2;
else if(args[0]==='ipc') {
  if(state.stopping && --state.stopping===0)state.running=false;
  writeFileSync(file,JSON.stringify(state));
  if(!state.running)process.exit(1);
  const marker=args.indexOf('--');
  if(args[marker+1]!=='screensaver')process.exit(2);
  const method=args[marker+2];
  if(method==='status')console.log(state.visible?'visible':'hidden');
  else if(method==='show')state.visible=true;
  else if(method==='hide')state.visible=false;
  else if(method==='snapshot')console.log(JSON.stringify(state.settings));
  else if(method==='reload') {
    const next=JSON.parse(args[marker+3]);
    if(next.idle_seconds===13){
      if(Bun.env.LUNA_TEST_EXTERNAL)writeFileSync(Bun.env.LUNA_TEST_CONFIG,Bun.env.LUNA_TEST_EXTERNAL);
      console.log('error: rejected fixture reload');
    } else {state.settings=next;state.visible=false;console.log('ok');}
  }else process.exit(3);
}else process.exit(4);
writeFileSync(file,JSON.stringify(state));
`,
    true,
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test("screensaver reads sparse JSONC afresh, preserves source and creates missing documents", async () => {
  expect(await Luna.screensaver.get(undefined, options())).toEqual({ succes: true, data: {} });
  expect(readFileSync(config, "utf8")).toBe("{}\n");
  const source = '// author settings\n{"idle_seconds":0,"future":null,}\n';
  write(config, source);
  expect(await Luna.screensaver.get("idle_seconds", options())).toEqual({ succes: true, data: 0 });
  expect(await Luna.screensaver.get("missing", options())).toEqual({ succes: true, data: null });
  expect(await Luna.screensaver.get("toString", options())).toEqual({ succes: true, data: null });
  expect(readFileSync(config, "utf8")).toBe(source);
  write(config, '{"idle_seconds":86400}');
  expect(await Luna.screensaver.get("idle_seconds", options())).toEqual({
    succes: true,
    data: 86400,
  });
  const explicit = join(root, "other/idle.jsonc");
  expect(await Luna.screensaver.get(undefined, { configFile: explicit, env: {} })).toEqual({
    succes: true,
    data: {},
  });
  expect(commands()).toHaveLength(0);
});

test("invalid screensaver settings and patches fail without altering source or controlling the UI", async () => {
  for (const idle_seconds of [-1, 86401, 1.5, true, "300", null]) {
    const source = JSON.stringify({ idle_seconds });
    write(config, source);
    expect(await Luna.screensaver.get(undefined, options())).toMatchObject({
      succes: false,
      err: "INVALID_METADATA",
    });
    expect(readFileSync(config, "utf8")).toBe(source);
    expect(await Luna.screensaver.configure({ idle_seconds }, options())).toMatchObject({
      succes: false,
      err: "INVALID_ARGUMENT",
    });
  }
  for (const source of ["null", "[]", "invalid JSONC"]) {
    write(config, source);
    expect(await Luna.screensaver.get(undefined, options())).toMatchObject({
      succes: false,
      err: "INVALID_METADATA",
    });
  }
  expect(commands()).toHaveLength(0);
});

test("screensaver lifecycle scopes IPC, snapshots settings/theme and waits for stop before replacement", async () => {
  write(config, '{"idle_seconds":0}');
  expect(await Luna.screensaver.status(options())).toMatchObject({
    succes: true,
    data: { status: "stopped", running: false },
  });
  expect(await Luna.screensaver.start(options())).toMatchObject({
    succes: true,
    data: { status: "hidden", running: true },
  });
  const started = commands().find((item) => item.args.includes("--daemonize"))!;
  expect(JSON.parse(started.settings!)).toEqual({ idle_seconds: 0 });
  expect(JSON.parse(started.theme!)).toMatchObject({
    name: "tokyo-night",
    fonts: { ui: expect.any(String) },
  });
  expect(JSON.parse(started.launcher!)).toEqual([
    join(root, ".local/bin/luna"),
    "screensaver",
    "--config",
    config,
  ]);
  expect(env.LUNA_SCREENSAVER_SETTINGS).toBeUndefined();
  expect(await Luna.screensaver.show(options())).toMatchObject({
    succes: true,
    data: { status: "visible" },
  });
  await Luna.screensaver.start(options());
  expect(state().visible).toBe(true);
  await Luna.screensaver.hide(options());
  expect(state().visible).toBe(false);
  write(config, '{"idle_seconds":20}');
  expect(state().settings).toEqual({ idle_seconds: 0 });
  expect(await Luna.screensaver.reload(options())).toMatchObject({
    succes: true,
    data: { status: "hidden" },
  });
  expect(state().settings).toEqual({ idle_seconds: 20 });
  expect(await Luna.screensaver.restart(options())).toMatchObject({
    succes: true,
    data: { status: "hidden" },
  });
  expect(commands().filter((item) => item.args.includes("--daemonize"))).toHaveLength(2);
  expect(await Luna.screensaver.stop(options())).toMatchObject({
    succes: true,
    data: { running: false },
  });
  expect(await Luna.screensaver.stop(options())).toMatchObject({
    succes: true,
    data: { running: false },
  });
  expect(await Luna.screensaver.reload(options())).toMatchObject({
    succes: true,
    data: { running: false },
  });
  for (const command of commands())
    expect(command.args).toContain(join(root, "config/luna/screensaver"));
});

test("configuration saves and reloads while failed application preserves disk and active snapshots separately", async () => {
  const before = '// source formatting\n{"idle_seconds":0,"future":true,}\n';
  write(config, before);
  await Luna.screensaver.start(options());
  write(config, '// unreloaded edits\n{"idle_seconds":50,"future":true}\n');
  const disk = readFileSync(config, "utf8");
  expect(await Luna.screensaver.configure({ idle_seconds: 13 }, options())).toMatchObject({
    succes: false,
    err: "COMMAND_FAILED",
  });
  expect(readFileSync(config, "utf8")).toBe(disk);
  expect(state().settings.idle_seconds).toBe(0);
  expect(await Luna.screensaver.configure({ idle_seconds: 40 }, options())).toEqual({
    succes: true,
    data: { idle_seconds: 40, future: true },
  });
  expect(state().settings.idle_seconds).toBe(40);
  env.LUNA_TEST_EXTERNAL = '{"idle_seconds":60}\n';
  expect(await Luna.screensaver.configure({ idle_seconds: 13 }, options())).toMatchObject({
    succes: false,
    err: "CONFLICT",
  });
  expect(readFileSync(config, "utf8")).toBe(env.LUNA_TEST_EXTERNAL);
});

test("a locked Hyprland session suppresses manual and idle show requests", async () => {
  env.HYPRLAND_INSTANCE_SIGNATURE = "fixture";
  env.LUNA_TEST_LOCKED = "1";
  expect(await Luna.screensaver.open(options())).toMatchObject({
    succes: true,
    data: { running: true, status: "hidden" },
  });
  expect(state().visible).toBe(false);
  env.LUNA_TEST_LOCKED = "0";
  expect(await Luna.screensaver.show(options())).toMatchObject({
    succes: true,
    data: { status: "visible" },
  });
  env.LUNA_TEST_LOCKED = "1";
  await Luna.screensaver.show(options());
  expect(state().visible).toBe(false);
  env.LUNA_TEST_LOCKED = "invalid";
  expect(await Luna.screensaver.show(options())).toMatchObject({
    succes: false,
    err: "COMMAND_FAILED",
  });
  expect(state().visible).toBe(false);
});

test("source QML, custom launcher and explicit JSONC paths are reflected in idle API invocations", async () => {
  const repository = join(root, "checkout");
  write(join(repository, "src/luna-screensaver/src/shell/shell.qml"), "// source");
  const configFile = join(root, "personal/settings.jsonc");
  const launcher = join(root, "custom luna");
  write(launcher, "#!/bin/sh\nexit 0\n", true);
  expect(await Luna.screensaver.start({ env, repository, configFile, launcher })).toMatchObject({
    succes: true,
    data: { configFile, shellDirectory: join(repository, "src/luna-screensaver/src/shell") },
  });
  const invocation = commands().find((item) => item.args.includes("--daemonize"))!;
  expect(JSON.parse(invocation.launcher!)).toEqual([
    launcher,
    "screensaver",
    "--config",
    configFile,
    "--install-dir",
    repository,
  ]);
  expect(await Luna.screensaver.getConfigFile({ env, configFile })).toEqual({
    succes: true,
    data: configFile,
  });
});
