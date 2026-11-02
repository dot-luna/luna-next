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
  const root = mkdtempSync(join(tmpdir(), "luna menu ' "));
  roots.push(root);
  const config = join(root, "config/luna");
  mkdirSync(join(config, "menu"), { recursive: true });
  writeFileSync(join(config, "menu/shell.qml"), "// fixture\n");
  mkdirSync(join(root, "bin"));
  const state = join(root, "state.json");
  const log = join(root, "commands.jsonl");
  const qs = join(root, "bin/qs");
  writeFileSync(
    qs,
    `#!${process.execPath}
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
const args = Bun.argv.slice(2);
appendFileSync(Bun.env.MENU_TEST_LOG, JSON.stringify({args, theme: Bun.env.LUNA_MENU_THEME}) + '\\n');
const file = Bun.env.MENU_TEST_STATE;
let state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {running:false, visible:false};
if (args.includes('--daemonize')) {
  if (Bun.env.MENU_TEST_FAIL) { console.error('fixture renderer failed'); process.exit(7); }
  state = {running:true, visible:false, theme:JSON.parse(Bun.env.LUNA_MENU_THEME)};
} else if (args[0] === 'ipc') {
  const marker = args.indexOf('--');
  if (marker < 0 || args[marker + 1] !== 'menu' || !state.running) process.exit(1);
  const method=args[marker + 2];
  if (method === 'status') console.log('running');
  else if (method === 'show' || method === 'system') { state.visible=true; state.section=method === 'system' ? 'system' : 'root'; }
  else if (method === 'hide') state.visible=false;
  else if (method === 'toggle') state.visible=!state.visible;
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
    MENU_TEST_STATE: state,
    MENU_TEST_LOG: log,
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

test("menu uses installed QML, starts only when needed, scopes IPC and snapshots the theme once", async () => {
  const f = fixture();
  expect(await Luna.menu.status(f.options)).toMatchObject({
    succes: true,
    data: { running: false, shellDirectory: join(f.config, "menu") },
  });
  expect(await Luna.menu.hide(f.options)).toMatchObject({ succes: true, data: { running: false } });
  expect(await Luna.menu.show(f.options)).toMatchObject({ succes: true, data: { running: true } });
  expect(f.state()).toMatchObject({ running: true, visible: true, theme: { name: "tokyo-night" } });
  expect(f.state().theme.appearance.opacity.active).toBeGreaterThan(0);
  await Luna.menu.toggle(f.options);
  expect(f.state().visible).toBe(false);
  await Luna.menu.start(f.options);
  expect(f.state().visible).toBe(false);
  await Luna.menu.show(f.options);
  expect(f.commands().filter((c) => c.args.includes("--daemonize"))).toHaveLength(1);
  for (const c of f.commands()) expect(c.args).toContain(join(f.config, "menu"));
  expect(await Luna.menu.stop(f.options)).toMatchObject({ succes: true, data: { running: false } });
  expect(await Luna.menu.stop(f.options)).toMatchObject({ succes: true, data: { running: false } });
});

test("source checkout selection is explicit and renderer failure is returned with diagnostics", async () => {
  const f = fixture();
  const repository = join(f.root, "source checkout");
  const shell = join(repository, "src/luna-menu/src/shell");
  mkdirSync(shell, { recursive: true });
  writeFileSync(join(shell, "shell.qml"), "// source\n");
  expect(await Luna.menu.status({ ...f.options, repository })).toMatchObject({
    succes: true,
    data: { shellDirectory: shell },
  });
  const failed = await Luna.menu.show({ env: { ...f.options.env, MENU_TEST_FAIL: "1" } });
  expect(failed).toMatchObject({ succes: false, err: "COMMAND_FAILED" });
  if (!failed.succes) expect(failed.errMessage).toContain("fixture renderer failed");
  expect(await Luna.menu.show({ ...f.options, repository: "relative" })).toMatchObject({
    succes: false,
    err: "INVALID_PATH",
  });
});

test.each([[], ["system"]])(
  "menu CLI opens the requested view %j and keeps JSON responses unchanged",
  (...args: string[]) => {
    const f = fixture();
    const cli = new URL("../../../src/luna-cli/src/index.ts", import.meta.url).pathname;
    const result = Bun.spawnSync([process.execPath, cli, "--json", "menu", ...args], {
      env: f.options.env,
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toMatchObject({
      succes: true,
      data: { running: true },
    });
    expect(f.state()).toMatchObject({
      visible: true,
      section: args[0] === "system" ? "system" : "root",
    });
  },
);

test("system starts a missing menu and opens its submenu in the existing instance", async () => {
  const f = fixture();
  expect(await Luna.menu.system(f.options)).toMatchObject({
    succes: true,
    data: { running: true },
  });
  expect(f.state()).toMatchObject({ visible: true, section: "system" });
  await Luna.menu.show(f.options);
  expect(f.state().section).toBe("root");
  await Luna.menu.system(f.options);
  expect(f.state()).toMatchObject({ visible: true, section: "system" });
  expect(f.commands().filter((command) => command.args.includes("--daemonize"))).toHaveLength(1);
});
