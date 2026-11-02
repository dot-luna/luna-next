import { afterEach, expect, test } from "bun:test";
import { $ } from "bun";
import { createApps, serializeResponse } from "../src/index.ts";
import { sandbox } from "./helpers.ts";

const fixtures: Awaited<ReturnType<typeof sandbox>>[] = [];
async function setup() { const value = await sandbox(); fixtures.push(value); return value; }
afterEach(async () => { for (const value of fixtures.splice(0)) await value.cleanup(); });

test("catalog order, package names, aliases, and capabilities", async () => {
  const s = await setup();
  await s.app("terminal", { name: "kitty", source: "pacman", alias: ["term"], runtime: { start: ["service", "start"], stop: ["service", "stop"] } });
  await s.app("git", { name: "git", source: "pacman" });
  await s.file(`${s.repository}/apps/apps.conf`, JSON.stringify({ packages: ["terminal/app.conf", "git/app.conf"] }));
  const listed = await s.apps.list();
  expect(listed.ok && listed.result.map(app => app.id)).toEqual(["terminal", "git"]);
  const info = await s.apps.info("term");
  expect(info.ok && info.result.id).toBe("terminal");
  expect(info.ok && info.result.capabilities).toContain("restart");
  expect(s.calls).toHaveLength(0);
});

test("environment paths and manifests are read again on each call", async () => {
  const s = await setup();
  await s.app("git", { name: "git", source: "pacman" });
  expect((await s.apps.info("git")).ok).toBe(true);
  await s.app("git", { name: "git", source: "pacman", alias: ["new-alias"] });
  expect((await s.apps.info("new-alias")).ok).toBe(true);
  const next = `${s.root}/next`;
  await s.file(`${next}/apps/other/app.conf`, JSON.stringify({ name: "other", source: "mise" }));
  s.env.LUNA_NEXT_ROOT = next;
  expect((await s.apps.info("other")).ok).toBe(true);
  const response = await s.apps.info("git");
  expect(!response.ok && response.error.code).toBe("APP_NOT_FOUND");
});

test("JSON syntax and Zod field validation produce standard failures", async () => {
  const s = await setup();
  await s.file(`${s.repository}/apps/git/app.conf`, 'name = "git"');
  let response = await s.apps.list();
  expect(!response.ok && response.error.code).toBe("INVALID_JSON");
  await s.file(`${s.repository}/apps/git/app.conf`, JSON.stringify({ name: "git", source: "pacman", unknown: true }));
  response = await s.apps.list();
  expect(!response.ok && response.error.code).toBe("INVALID_MANIFEST");
  expect(JSON.parse(serializeResponse(response))).toEqual(response);
  expect(s.calls).toHaveLength(0);
});

test("ambiguous aliases and duplicate batch selections are rejected", async () => {
  const s = await setup();
  await s.app("one", { name: "one", source: "pacman", alias: ["shared"] });
  await s.app("two", { name: "two", source: "pacman", alias: ["shared"] });
  const ambiguous = await s.apps.list();
  expect(!ambiguous.ok && ambiguous.error.code).toBe("AMBIGUOUS_APP");
  await s.app("two", { name: "two", source: "pacman" });
  const duplicate = await s.apps.install(["one", "shared"]);
  expect(!duplicate.ok && duplicate.error.code).toBe("DUPLICATE_APP");
  expect(s.calls).toHaveLength(0);
});

test("unsupported actions and invalid later hooks fail before any app runs", async () => {
  const s = await setup();
  await s.app("one", { name: "one", source: "pacman", runtime: { start: ["start-one"] } });
  await s.app("two", { name: "two", source: "pacman" });
  const unsupported = await s.apps.start(["one", "two"]);
  expect(!unsupported.ok && unsupported.error.code).toBe("UNSUPPORTED_ACTION");
  await s.app("two", { name: "two", source: "pacman", hooks: { before_install: ["../outside"] } });
  const invalid = await s.apps.install(["one", "two"]);
  expect(!invalid.ok && invalid.error.code).toBe("INVALID_PATH");
  expect(s.calls).toHaveLength(0);
});

test("install batches preserve completed and unattempted app results", async () => {
  const s = await setup();
  for (const id of ["one", "two", "three"]) await s.app(id, { name: id, source: "pacman" });
  s.behavior(request => ({ exitCode: request.argv.includes("-Q") ? 1 : request.argv.at(-1) === "two" ? 9 : 0, stdout: "", stderr: "failure" }));
  const response = await s.apps.install(["one", "two", "three"]);
  expect(!response.ok && response.error.code).toBe("BATCH_FAILED");
  if (response.ok) throw new Error("Expected batch failure");
  expect(response.error.details).toMatchObject({ completed: [{ app: "one" }], failed: { app: "two", error: { code: "COMMAND_FAILED" } }, unattempted: ["three"] });
  expect(s.calls.some(call => call.argv.at(-1) === "three")).toBe(false);
});

test("package actions use argv arrays and status distinguishes unsupported runtime", async () => {
  const s = await setup();
  await s.app("git", { name: "git", source: "pacman" });
  s.behavior(() => ({ exitCode: 1, stdout: "", stderr: "" }));
  const status = await s.apps.status(["git"]);
  expect(status.ok && status.result.completed[0]?.status).toEqual({ installed: false, running: null });
  s.behavior(request => ({ exitCode: request.argv.includes("-Q") ? 1 : 0, stdout: "", stderr: "" }));
  expect((await s.apps.install(["git"])).ok).toBe(true);
  expect(s.calls.at(-1)?.argv).toEqual(["sudo", "pacman", "-S", "--needed", "--noconfirm", "--", "git"]);
});

test("restart uses stop then start, reload never substitutes restart", async () => {
  const s = await setup();
  await s.app("service", { name: "service", source: "pacman", runtime: { start: ["service", "start"], stop: ["service", "stop"], status: ["service", "status"] } });
  expect((await s.apps.restart(["service"])).ok).toBe(true);
  expect(s.calls.map(call => call.argv)).toEqual([["service", "stop"], ["service", "start"]]);
  const response = await s.apps.reload(["service"]);
  expect(!response.ok && response.error.code).toBe("UNSUPPORTED_ACTION");
  s.behavior(request => ({ exitCode: request.argv[0] === "service" ? 3 : 0, stdout: "", stderr: "" }));
  const status = await s.apps.status(["service"]);
  expect(status.ok && status.result.completed[0]?.status).toEqual({ installed: true, running: false });
});

test("dangerous actions require explicit names", async () => {
  const s = await setup();
  const response = await s.apps.uninstall([]);
  expect(!response.ok && response.error.code).toBe("INVALID_ARGUMENT");
});

test("real Bun child output and logger messages leave stdout clean", async () => {
  const s = await setup();
  await s.app("service", { name: "service", source: "pacman", runtime: { start: ["/bin/sh", "-c", "printf child-out; printf child-err >&2"] } });
  const module = Bun.fileURLToPath(new URL("../src/index.ts", import.meta.url));
  const source = `import {createApps,serializeResponse} from ${JSON.stringify(module)}; await Bun.write(Bun.stdout,serializeResponse(await createApps({env:${JSON.stringify(s.env)}}).start(["service"])));`;
  const child = Bun.spawn([Bun.argv[0]!, "-e", source], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(await child.exited).toBe(0);
  expect(JSON.parse(stdout)).toMatchObject({ ok: true });
  expect(stdout.trim().split("\n")).toHaveLength(1);
  expect(stderr).toContain("child-out");
  expect(stderr).toContain("child-err");
  expect(stderr).toContain("Running app action");
});

test("per-app lock prevents a concurrent mutation and releases after completion", async () => {
  const s = await setup();
  await s.app("service", { name: "service", source: "pacman", runtime: { start: ["start"] } });
  let release!: () => void;
  let entered!: () => void;
  const running = new Promise<void>(resolve => { entered = resolve; });
  s.behavior(async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); return { exitCode: 0, stdout: "", stderr: "" }; });
  const first = s.apps.start(["service"]);
  await running;
  const second = await s.apps.start(["service"]);
  expect(!second.ok && second.error.details).toMatchObject({ failed: { error: { code: "BUSY" } } });
  release();
  expect((await first).ok).toBe(true);
  s.behavior(() => ({ exitCode: 0, stdout: "", stderr: "" }));
  expect((await s.apps.start(["service"])).ok).toBe(true);
});
