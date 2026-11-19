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
  const root = mkdtempSync(join(tmpdir(), "luna bar ' "));
  roots.push(root);
  const config = join(root, "config/luna");
  mkdirSync(join(config, "bar"), { recursive: true });
  writeFileSync(join(config, "bar/shell.qml"), "// fixture\n");
  mkdirSync(join(root, "bin"));
  const state = join(root, "state.json");
  const log = join(root, "commands.jsonl");
  const qs = join(root, "bin/qs");
  writeFileSync(
    qs,
    `#!${process.execPath}
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
const args = Bun.argv.slice(2);
appendFileSync(Bun.env.BAR_TEST_LOG, JSON.stringify({args, theme: Bun.env.LUNA_BAR_THEME}) + '\\n');
const file = Bun.env.BAR_TEST_STATE;
let state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {running:false};
if (args.includes('--daemonize')) {
  if (Bun.env.BAR_TEST_FAIL) { console.error('fixture renderer failed'); process.exit(7); }
  state = {running:true, theme:JSON.parse(Bun.env.LUNA_BAR_THEME)};
} else if (args[0] === 'ipc') {
  const marker = args.indexOf('--');
  if (marker < 0 || args[marker + 1] !== 'bar' || !state.running) process.exit(1);
  const method=args[marker + 2];
  if (method === 'status') console.log('running');
  else if (method === 'focus') state.focused=true;
  else process.exit(2);
} else if (args[0] === 'kill') state.running=false;
else process.exit(3);
writeFileSync(file, JSON.stringify(state));
`,
  );
  chmodSync(qs, 0o755);
  const env = {
    HOME: root,
    PATH: join(root, "bin"),
    XDG_CONFIG_HOME: join(root, "config"),
    BAR_TEST_STATE: state,
    BAR_TEST_LOG: log,
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

test("bar scopes its lifecycle, reuses starts, focuses, and refreshes the theme on restart", async () => {
  const f = fixture();
  expect(await Luna.bar.status(f.options)).toMatchObject({
    succes: true,
    data: { running: false },
  });
  expect(await Luna.bar.stop(f.options)).toMatchObject({ succes: true, data: { running: false } });
  expect(await Luna.bar.start(f.options)).toMatchObject({ succes: true, data: { running: true } });
  expect(f.state().theme.fonts.ui).toBeTruthy();
  await Luna.bar.start(f.options);
  await Luna.bar.focus(f.options);
  expect(f.state().focused).toBe(true);
  expect(f.commands().filter((c) => c.args.includes("--daemonize"))).toHaveLength(1);
  expect(await Luna.bar.restart(f.options)).toMatchObject({
    succes: true,
    data: { running: true },
  });
  expect(f.commands().filter((c) => c.args.includes("--daemonize"))).toHaveLength(2);
  for (const c of f.commands()) expect(c.args).toContain(join(f.config, "bar"));
  expect(await Luna.bar.stop(f.options)).toMatchObject({ succes: true, data: { running: false } });
  expect(await Luna.bar.focus(f.options)).toMatchObject({ succes: true, data: { running: true } });
});

test("bar accepts an explicit checkout and reports missing paths and renderer failures", async () => {
  const f = fixture();
  const repository = join(f.root, "checkout");
  const shell = join(repository, "src/luna-bar/src/shell");
  mkdirSync(shell, { recursive: true });
  writeFileSync(join(shell, "shell.qml"), "// fixture");
  expect(await Luna.bar.status({ ...f.options, repository })).toMatchObject({
    succes: true,
    data: { shellDirectory: shell },
  });
  for (const repository of ["relative", join(f.root, "missing")])
    expect(await Luna.bar.start({ ...f.options, repository })).toMatchObject({
      succes: false,
      err: "INVALID_PATH",
    });
  expect(await Luna.bar.start({ env: { ...f.options.env, BAR_TEST_FAIL: "1" } })).toMatchObject({
    succes: false,
    err: "COMMAND_FAILED",
    errMessage: expect.stringContaining("fixture renderer failed"),
  });
});

test("invalid theme does not stop a running bar during restart", async () => {
  const f = fixture();
  await Luna.bar.start(f.options);
  writeFileSync(join(f.config, "theme.jsonc"), "invalid");
  const response = await Luna.bar.restart(f.options);
  expect(response.succes).toBe(false);
  expect(f.state().running).toBe(true);
  expect(f.commands().some((c) => c.args[0] === "kill")).toBe(false);
});

test("bar CLI starts by default and supports status, focus, restart and stop", () => {
  const f = fixture();
  const cli = new URL("../../../src/luna-cli/src/index.ts", import.meta.url).pathname;
  for (const args of [[], ["status"], ["focus"], ["restart"], ["stop"]]) {
    const result = Bun.spawnSync([process.execPath, cli, "--json", "bar", ...args], {
      env: f.options.env,
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toMatchObject({
      succes: true,
      data: { running: args[0] !== "stop" },
    });
  }
});
