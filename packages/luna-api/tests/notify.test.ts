import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Luna } from "../src/index.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "luna notify ' "));
  roots.push(root);
  const config = join(root, "config/luna");
  mkdirSync(join(config, "notify"), { recursive: true });
  writeFileSync(join(config, "notify/shell.qml"), "// fixture\n");
  cpSync(
    new URL("../../../src/luna-notify/src/shell/icons", import.meta.url).pathname,
    join(config, "notify/icons"),
    { recursive: true },
  );
  mkdirSync(join(root, "bin"));
  const state = join(root, "state.json");
  const log = join(root, "commands.jsonl");
  const qs = join(root, "bin/qs");
  writeFileSync(
    qs,
    `#!${process.execPath}
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
const args = Bun.argv.slice(2);
appendFileSync(Bun.env.NOTIFY_TEST_LOG, JSON.stringify({args, theme: Bun.env.LUNA_NOTIFY_THEME}) + '\\n');
const file = Bun.env.NOTIFY_TEST_STATE;
let state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {running:false};
if (args.includes('--daemonize')) {
  if (Bun.env.NOTIFY_TEST_FAIL) { console.error('fixture renderer failed'); process.exit(7); }
  state = {running:true, theme:JSON.parse(Bun.env.LUNA_NOTIFY_THEME), settings:JSON.parse(Bun.env.LUNA_NOTIFY_SETTINGS)};
} else if (args[0] === 'ipc') {
  const marker = args.indexOf('--');
  if (marker < 0 || args[marker + 1] !== 'notify' || !state.running) process.exit(1);
  const method=args[marker + 2];
  if (method === 'pid') console.log('1234');
  else if (method === 'focus' || method === 'dismiss') state.action=method;
  else process.exit(2);
} else if (args[0] === 'kill') state.running=false;
else process.exit(3);
writeFileSync(file, JSON.stringify(state));
`,
  );
  chmodSync(qs, 0o755);
  const busctl = join(root, "bin/busctl");
  writeFileSync(
    busctl,
    `#!${process.execPath}
import {existsSync, readFileSync} from 'node:fs';
if (Bun.env.NOTIFY_TEST_BUS_FAIL) { console.error('No session bus'); process.exit(1); }
if (Bun.env.NOTIFY_TEST_COMPETITOR) console.log('u 99');
else if (Bun.env.NOTIFY_TEST_NO_OWNER) { console.error('no such name'); process.exit(1); }
else if (existsSync(Bun.env.NOTIFY_TEST_STATE) && JSON.parse(readFileSync(Bun.env.NOTIFY_TEST_STATE,'utf8')).running) console.log('u 1234');
else { console.error('no such name'); process.exit(1); }
`,
  );
  chmodSync(busctl, 0o755);
  const env = {
    HOME: root,
    PATH: join(root, "bin"),
    XDG_CONFIG_HOME: join(root, "config"),
    NOTIFY_TEST_STATE: state,
    NOTIFY_TEST_LOG: log,
  };
  return {
    root,
    config,
    state: () => JSON.parse(readFileSync(state, "utf8")),
    commands: () =>
      readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    options: { env },
  };
}

test("notification lifecycle confirms bus ownership, is idempotent, scopes controls and refreshes the theme", async () => {
  const f = fixture();
  expect(await Luna.notify.status(f.options)).toMatchObject({
    succes: true,
    data: { running: false },
  });
  expect(await Luna.notify.focus(f.options)).toMatchObject({
    succes: true,
    data: { running: false },
  });
  expect(await Luna.notify.start(f.options)).toMatchObject({
    succes: true,
    data: { running: true, shellDirectory: join(f.config, "notify") },
  });
  expect(f.state().theme.name).toBe("tokyo-night");
  await Luna.notify.start(f.options);
  expect(f.commands().filter((c) => c.args.includes("--daemonize"))).toHaveLength(1);
  await Luna.notify.focus(f.options);
  expect(f.state().action).toBe("focus");
  await Luna.notify.dismiss(f.options);
  expect(f.state().action).toBe("dismiss");
  await Luna.notify.restart(f.options);
  expect(f.commands().filter((c) => c.args.includes("--daemonize"))).toHaveLength(2);
  for (const c of f.commands()) expect(c.args).toContain(join(f.config, "notify"));
  expect(await Luna.notify.stop(f.options)).toMatchObject({
    succes: true,
    data: { running: false },
  });
  expect(await Luna.notify.stop(f.options)).toMatchObject({
    succes: true,
    data: { running: false },
  });
});

test("notification startup rejects another provider and reports missing buses and launch failures", async () => {
  const f = fixture();
  expect(
    await Luna.notify.start({ env: { ...f.options.env, NOTIFY_TEST_COMPETITOR: "1" } }),
  ).toMatchObject({ succes: false, err: "CONFLICT" });
  expect(f.commands().some((c) => c.args.includes("--daemonize"))).toBe(false);
  expect(
    await Luna.notify.start({ env: { ...f.options.env, NOTIFY_TEST_BUS_FAIL: "1" } }),
  ).toMatchObject({ succes: false, err: "COMMAND_FAILED" });
  const failed = await Luna.notify.start({ env: { ...f.options.env, NOTIFY_TEST_FAIL: "1" } });
  expect(failed).toMatchObject({ succes: false, err: "COMMAND_FAILED" });
  if (!failed.succes) expect(failed.errMessage).toContain("fixture renderer failed");
  expect(await Luna.notify.start({ ...f.options, repository: "relative" })).toMatchObject({
    succes: false,
    err: "INVALID_PATH",
  });
});

test("notification status rejects an instance that lost ownership and failed acquisition cleans up only its shell", async () => {
  const f = fixture();
  await Luna.notify.start(f.options);
  const env = { ...f.options.env, NOTIFY_TEST_COMPETITOR: "1" };
  expect(await Luna.notify.status({ env })).toMatchObject({
    succes: true,
    data: { running: false },
  });
  expect(await Luna.notify.start({ env })).toMatchObject({ succes: false, err: "CONFLICT" });
  await Luna.notify.stop(f.options);
  expect(
    await Luna.notify.start({ env: { ...f.options.env, NOTIFY_TEST_NO_OWNER: "1" } }),
  ).toMatchObject({ succes: false, err: "COMMAND_FAILED" });
  expect(f.state().running).toBe(false);
}, 10000);

test("notification CLI keeps JSON responses and supports explicit source paths", () => {
  const f = fixture();
  const repository = join(f.root, "source checkout");
  const shell = join(repository, "src/luna-notify/src/shell");
  mkdirSync(shell, { recursive: true });
  writeFileSync(join(shell, "shell.qml"), "// source");
  cpSync(join(f.config, "notify/icons"), join(shell, "icons"), { recursive: true });
  const cli = new URL("../../../src/luna-cli/src/index.ts", import.meta.url).pathname;
  const result = Bun.spawnSync(
    [process.execPath, cli, "--json", "notify", "--install-dir", repository, "start"],
    { env: f.options.env },
  );
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  expect(JSON.parse(result.stdout.toString())).toMatchObject({
    succes: true,
    data: { running: true, shellDirectory: shell },
  });
});

test("notify reads sparse JSONC once, preserves source, and rejects invalid restart before stopping the provider", async () => {
  const f = fixture();
  const configFile = join(f.config, "notify.jsonc");
  const source =
    '// Personal notification settings\n{"priority":{"low":{"opacity":0.8}},"appearance":{"width":320}}\n';
  writeFileSync(configFile, source);
  expect(await Luna.notify.get("priority.low.opacity", f.options)).toEqual({
    succes: true,
    data: 0.8,
  });
  expect(await Luna.notify.get("priority.critical.strip_width", f.options)).toEqual({
    succes: true,
    data: null,
  });
  expect(await Luna.notify.start(f.options)).toMatchObject({
    succes: true,
    data: { running: true, configFile },
  });
  expect(f.state().settings).toMatchObject({
    appearance: { width: 320 },
    priority: { low: { opacity: 0.8 }, critical: { strip_width: 4 } },
  });
  expect(f.state().settings.priority.critical.icon_source).toStartWith(
    "data:image/svg+xml;base64,",
  );
  expect(readFileSync(configFile, "utf8")).toBe(source);
  writeFileSync(configFile, '{"priority":{"critical":{"strip_width":7,"title_color":"#ff8877"}}}');
  await Luna.notify.start(f.options);
  expect(f.state().settings.priority.critical.strip_width).toBe(4);
  await Luna.notify.restart(f.options);
  expect(f.state().settings.priority.critical).toMatchObject({
    strip_width: 7,
    title_color: "#ff8877",
  });
  writeFileSync(configFile, '{"priority":{"low":{"opacity":-1}}}');
  const killed = f.commands().filter((c) => c.args[0] === "kill").length;
  expect(await Luna.notify.restart(f.options)).toMatchObject({
    succes: false,
    err: "INVALID_METADATA",
  });
  expect(f.commands().filter((c) => c.args[0] === "kill")).toHaveLength(killed);
  expect(f.state().running).toBe(true);
});

test("notify settings honor explicit and environment paths without Quickshell, create missing files, and leave omitted values null", async () => {
  const f = fixture();
  const env = { ...f.options.env, PATH: "", LUNA_NOTIFY_CONFIG: join(f.root, "env/notify.jsonc") };
  const configFile = join(f.root, "custom/notify.jsonc");
  expect(await Luna.notify.getConfigFile({ env })).toEqual({
    succes: true,
    data: env.LUNA_NOTIFY_CONFIG,
  });
  expect(await Luna.notify.getConfigFile({ env, configFile })).toEqual({
    succes: true,
    data: configFile,
  });
  expect(await Luna.notify.get(undefined, { env, configFile })).toEqual({ succes: true, data: {} });
  expect(await Luna.notify.get("priority.low.opacity", { env, configFile })).toEqual({
    succes: true,
    data: null,
  });
  expect(readFileSync(configFile, "utf8")).toBe("{}\n");
  expect(await Luna.notify.get("priority..low", { env, configFile })).toMatchObject({
    succes: false,
    err: "INVALID_ARGUMENT",
  });
  const cli = new URL("../../../src/luna-cli/src/index.ts", import.meta.url).pathname;
  const result = Bun.spawnSync(
    [process.execPath, cli, "--json", "notify", "--config", configFile, "get", "appearance.width"],
    { env },
  );
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  expect(JSON.parse(result.stdout.toString())).toEqual({ succes: true, data: null });
});

test.each([
  { appearance: { width: 0 } },
  { stack: { limit: 0 } },
  { stack: { expand_on_hover: "yes" } },
  { priority: { critical: { strip_width: 13 } } },
  { priority: { critical: { strip_side: "top" } } },
  { priority: { normal: { icon: "../../untrusted" } } },
  { priority: { critical: { title_color: "red" } } },
])("notify rejects invalid source settings without rewriting them: %j", async (value) => {
  const f = fixture();
  const configFile = join(f.root, "notify.jsonc");
  const source = JSON.stringify(value);
  writeFileSync(configFile, source);
  expect(await Luna.notify.get(undefined, { ...f.options, configFile })).toMatchObject({
    succes: false,
    err: "INVALID_METADATA",
  });
  expect(readFileSync(configFile, "utf8")).toBe(source);
});
