import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Luna } from "../src/index.ts";
import { InstallContext } from "../src/self/install/command.ts";
import { closeApp, type AppProcess, type ProcessControl } from "../src/apps/processes.ts";
import { AppFixture } from "./fixtures/app-fixture.ts";

let f: AppFixture;
beforeEach(() => {
  f = new AppFixture();
});
afterEach(() => f.dispose());
const context = () => new InstallContext(f.repository, f.home, f.env, () => {});

test("skip-failed collects multiple app failures, continues and writes actionable private reports", async () => {
  f.app("first", { name: "first", source: "local" }, ["build"]);
  f.app("second", { name: "second", source: "local" }, ["build"]);
  f.app("last", { name: "last", source: "local" }, ["before_configure"]);
  for (const id of ["first", "second"])
    f.write(
      f.repository,
      `apps/${id}/hooks/build.ts`,
      `#!${process.execPath}\nconsole.log("full build stdout ${id}");console.error("build failure ${id}");process.exit(7);\n`,
    );
  const result = await Luna.apps.install([], { env: f.env, skipFailed: true });
  expect(result.succes).toBe(true);
  if (!result.succes) return;
  expect(result.data).toMatchObject({
    completed: false,
    installed: ["last"],
    failed: [{ app: "first" }, { app: "second" }],
  });
  expect(result.data.failed[0]!.retry).toContain("install 'first'");
  expect(statSync(result.data.logDirectory).mode & 0o777).toBe(0o700);
  const summary = JSON.parse(readFileSync(join(result.data.logDirectory, "summary.json"), "utf8"));
  expect(summary.failed).toHaveLength(2);
  const files = readdirSync(result.data.logDirectory).filter((name) => name.endsWith(".log"));
  expect(
    files.some((name) =>
      readFileSync(join(result.data.logDirectory, name), "utf8").includes(
        "full build stdout first",
      ),
    ),
  ).toBe(true);
  for (const name of files)
    expect(statSync(join(result.data.logDirectory, name)).mode & 0o777).toBe(0o600);
});

test("self skip-failed finishes later packages and web apps without claiming completion", async () => {
  f.browser();
  f.app("broken", { name: "broken", source: "local" }, ["build"]);
  f.write(
    f.repository,
    "installs/packages.webapp.jsonc",
    '[{"name":"Finish Web","url":"https://example.test"}]',
  );
  const response = await Luna.self.install({
    env: { ...f.env, APP_FAIL: "broken:build" },
    fromBootstrap: true,
    git: { name: "Test", email: "test@example.test" },
    skipFailed: true,
  });
  expect(response).toMatchObject({
    succes: true,
    data: { completed: false, failed: [{ app: "broken" }], installedWebapps: ["Finish Web"] },
  });
  expect(f.commands().some((c) => c.name === "pacman" && c.args.includes("zed"))).toBe(true);
});

test("required package failures still stop even with skip-failed and preserve logs", async () => {
  const response = await Luna.self.install({
    env: { ...f.env, SELF_FAIL: "pacman:-S" },
    fromBootstrap: true,
    skipFailed: true,
  });
  expect(response).toMatchObject({
    succes: false,
    err: "COMMAND_FAILED",
    errMessage: expect.stringContaining("Logs:"),
  });
  const root = join(f.home, ".local/state/luna/install-logs");
  expect(readdirSync(root)).toHaveLength(1);
  expect(existsSync(join(root, readdirSync(root)[0]!, "summary.json"))).toBe(true);
});

test("long build output is complete on disk while diagnostics stay bounded", async () => {
  const c = context();
  const result = await c.execute(
    [
      process.execPath,
      "-e",
      'process.stdout.write("x".repeat(2_000_000));process.stderr.write("error tail");',
    ],
    false,
    f.repository,
    true,
  );
  expect(result.stdout.length).toBe(65536);
  expect(result.stderr).toBe("error tail");
  expect(statSync(join(c.log.directory, "0001.stdout.log")).size).toBe(2_000_000);
});

function processFixture(initial: AppProcess[], stubborn = false) {
  let processes = [...initial],
    now = 0;
  const signals: { pid: number; signal: string }[] = [];
  const control: ProcessControl = {
    self: 999,
    list: async () => processes,
    signal: (pid, signal) => {
      signals.push({ pid, signal });
      if (signal === "SIGKILL" || !stubborn)
        processes = processes.filter((item) => item.pid !== pid && item.parent !== pid);
    },
    pause: async (ms) => {
      now += ms;
    },
    now: () => now,
  };
  return {
    control,
    signals,
    replace: (values: AppProcess[]) => {
      processes = values;
    },
  };
}
const app = {
  id: "browser",
  directory: "/unused",
  manifest: { name: "browser", source: "local" as const, processes: ["chromium"] },
};

test("app shutdown warns, terminates only declared identities and escalates after grace", async () => {
  const mock = processFixture(
    [
      { pid: 100, parent: 1, started: "1", executable: "chromium" },
      { pid: 101, parent: 100, started: "2", executable: "chromium" },
      { pid: 200, parent: 1, started: "3", executable: "unrelated" },
    ],
    true,
  );
  await closeApp(context(), app, mock.control);
  expect(mock.signals).toEqual([
    { pid: 100, signal: "SIGTERM" },
    { pid: 100, signal: "SIGKILL" },
    { pid: 101, signal: "SIGKILL" },
  ]);
  expect(mock.control.now()).toBeGreaterThanOrEqual(8000);
});

test("shutdown does not kill the installer host or a reused PID", async () => {
  const host = processFixture([
    { pid: 999, parent: 100, started: "4", executable: "bun" },
    { pid: 100, parent: 1, started: "1", executable: "chromium" },
  ]);
  await expect(closeApp(context(), app, host.control)).rejects.toThrow("hosting");
  expect(host.signals).toEqual([]);
  const mock = processFixture([{ pid: 100, parent: 1, started: "1", executable: "chromium" }]);
  mock.control.pause = async () =>
    mock.replace([{ pid: 100, parent: 1, started: "2", executable: "unrelated" }]);
  await closeApp(context(), app, mock.control);
  expect(mock.signals).toEqual([]);
});

test("already installed Mise tools are selected globally and activation is installed idempotently", async () => {
  f.app("tool", { name: "tool", source: "mise", version: "1" }, ["before_install"]);
  f.write(f.home, ".bashrc", "# personal bash\n");
  f.write(f.home, ".zshrc", "# personal zsh\n");
  const options = { env: { ...f.env, SELF_MISE_VERSIONS: '["1.2.3"]' } };
  expect(await Luna.apps.install([], options)).toMatchObject({
    succes: true,
    data: { completed: true },
  });
  expect(await Luna.apps.install([], options)).toMatchObject({
    succes: true,
    data: { completed: true },
  });
  expect(f.hooks()).toEqual([]);
  expect(
    f
      .commands()
      .filter((c) => c.name === "mise" && c.args.includes("use"))
      .every((c) => c.args.includes("--global") && c.args.includes("tool@1.2.3")),
  ).toBe(true);
  expect(f.commands().some((c) => c.name === "mise" && c.args.includes("reshim"))).toBe(true);
  for (const shell of ["bash", "zsh"]) {
    const text = readFileSync(join(f.home, `.${shell}rc`), "utf8");
    expect(text.match(/# BEGIN LUNA MISE/gu)).toHaveLength(1);
    expect(text).toContain(`activate ${shell}`);
    expect(text).toContain(`# personal ${shell}`);
  }
});

test("new Bash and Zsh sessions evaluate Mise activation once", async () => {
  f.app("tool", { name: "tool", source: "mise" });
  expect(await Luna.apps.install([], { env: f.env })).toMatchObject({ succes: true });
  for (const shell of ["bash", "zsh"]) {
    const executable = Bun.which(shell);
    if (!executable) continue;
    const child = Bun.spawnSync(
      [executable, "-ic", `source "$HOME/.${shell}rc"; [[ \${LUNA_TEST_MISE_ACTIVE:-} == 1 ]]`],
      { env: f.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
    );
    expect(child.exitCode, child.stderr.toString()).toBe(0);
  }
  const activations = f.commands().filter((c) => c.name === "mise" && c.args[0] === "activate");
  expect(activations.filter((c) => c.args[1] === "bash")).toHaveLength(1);
  if (Bun.which("zsh")) expect(activations.filter((c) => c.args[1] === "zsh")).toHaveLength(1);
});

test("CLI partial results are JSON-clean and exit unsuccessfully with retry details", async () => {
  f.app("broken", { name: "broken", source: "local" }, ["build"]);
  f.app("later", { name: "later", source: "local" });
  const { resolve } = await import("node:path");
  const entry = resolve(import.meta.dir, "../../../src/luna-cli/src/index.ts");
  const child = Bun.spawn([process.execPath, entry, "install", "--skip-failed", "--json"], {
    env: { ...f.env, APP_FAIL: "broken:build" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(code).toBe(1);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toMatchObject({
    succes: true,
    data: {
      completed: false,
      installed: ["later"],
      failed: [{ app: "broken", retry: expect.stringContaining("install 'broken'") }],
    },
  });
});

test("non-executable hooks fail preflight before authentication or package installation", async () => {
  f.app("invalid", { name: "invalid", source: "pacman" }, ["before_install"]);
  const { chmodSync } = await import("node:fs");
  chmodSync(join(f.repository, "apps/invalid/hooks/before_install.ts"), 0o644);
  expect(await Luna.apps.install([], { env: f.env, skipFailed: true })).toMatchObject({
    succes: false,
    err: "INVALID_METADATA",
  });
  expect(f.commands().some((item) => ["sudo", "pacman"].includes(item.name))).toBe(false);
});

test("a locked app is never shut down by concurrent install or configuration", async () => {
  const { cpSync } = await import("node:fs");
  const { locked } = await import("../src/lib/files.ts");
  const executable = join(f.bin, `worker-${process.pid}-${Date.now()}`);
  cpSync(Bun.which("sleep")!, executable);
  f.app("worker", { name: "worker", source: "local", processes: [executable.split("/").at(-1)!] });
  const worker = Bun.spawn([executable, "30"], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  const messages: string[] = [];
  try {
    await locked(
      { configFile: join(f.home, ".local/state/luna/apps/worker.jsonc"), env: f.env },
      async () => {
        for (const operation of [Luna.apps.install, Luna.apps.configure]) {
          expect(
            await operation(["worker"], {
              env: f.env,
              onProgress: (message) => messages.push(message),
            }),
          ).toMatchObject({ succes: false, err: "CONFLICT" });
          expect(worker.exitCode).toBeNull();
        }
      },
    );
    expect(messages.some((message) => message.startsWith("Closing"))).toBe(false);
  } finally {
    worker.kill();
    await worker.exited;
  }
}, 15000);

test.each([false, true])(
  "saved Mise data defaults precede integrated Zsh activation (custom ZDOTDIR: %s)",
  async (custom) => {
    const { cpSync, mkdirSync } = await import("node:fs");
    const { setupMise } = await import("../src/self/install/mise.ts");
    const { integrate } = await import("../src/apps/integration.ts");
    const data = join(f.root, "custom mise data");
    f.env.MISE_DATA_DIR = data;
    const zshHome = custom ? join(f.root, "custom zdot") : f.home;
    if (custom) {
      f.env.ZDOTDIR = zshHome;
      mkdirSync(zshHome);
    }
    await setupMise(context());
    const exported = join(f.home, ".config/luna/zsh/zshrc");
    mkdirSync(join(exported, ".."), { recursive: true });
    cpSync(new URL("../../../apps/zsh/config/tools.zsh", import.meta.url), exported);
    await integrate(exported, join(zshHome, ".zshrc"), "include");
    const env = { ...f.env };
    delete env.MISE_DATA_DIR;
    const result = Bun.spawnSync([Bun.which("zsh")!, "-ic", "[[ -n ${MISE_DATA_DIR:-} ]]"], {
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    const activations = f
      .commands()
      .filter((call) => call.name === "mise" && call.args[0] === "activate");
    expect(activations).toHaveLength(1);
    expect(activations[0]?.miseData).toBe(data);
  },
);

test("suggested retries preserve forced rebuilds and the no-close-apps choice", async () => {
  const { chmodSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const entry = resolve(import.meta.dir, "../../../src/luna-cli/src/index.ts");
  f.write(
    f.home,
    ".local/bin/luna",
    `#!${Bun.which("bash")}\nexec ${[process.execPath, entry].map(quote).join(" ")} "$@"\n`,
  );
  chmodSync(f.executable, 0o755);
  f.app("rebuild", { name: "rebuild", source: "local" }, ["build"]);
  expect(await Luna.apps.install([], { env: f.env })).toMatchObject({ succes: true });
  const response = await Luna.apps.install([], {
    env: { ...f.env, APP_FAIL: "rebuild:build" },
    force: true,
    closeApps: false,
    skipFailed: true,
  });
  if (!response.succes) throw new Error(response.errMessage);
  const retry = response.data.failed[0]!.retry;
  expect(retry).toContain("--force");
  expect(retry).toContain("--no-close-apps");
  const run = Bun.spawnSync([Bun.which("bash")!, "-c", retry + " --json"], {
    env: f.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(run.exitCode, run.stderr.toString()).toBe(0);
  expect(JSON.parse(run.stdout.toString())).toMatchObject({
    succes: true,
    data: { completed: true },
  });
  expect(f.hooks().filter((hook) => hook.stage === "build")).toHaveLength(3);
});
