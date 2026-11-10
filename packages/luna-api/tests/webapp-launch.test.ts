import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Luna, type ApiResponse } from "../src/index.ts";
import { AppFixture } from "./fixtures/app-fixture.ts";

let fixture: AppFixture;
beforeEach(() => {
  fixture = new AppFixture();
  fixture.browser();
});
afterEach(() => fixture.dispose());

function data<T>(response: ApiResponse<T>): T {
  if (!response.succes) throw new Error(response.errMessage);
  return response.data;
}

/** Seed an installed record without network discovery; launch does not need an icon or desktop entry. */
function installedApp(name: string) {
  const app = {
    name,
    id: `luna-webapp-${Buffer.from(name).toString("hex")}`,
    url: "https://example.test/",
  };
  fixture.write(fixture.home, `.local/share/luna/webapps/${app.id}/app.jsonc`, JSON.stringify(app));
  return app;
}

/** Use an isolated compositor stub so tests never focus a window in the user's desktop session. */
function mockHyprland(clients: unknown, focusResponse = "ok") {
  fixture.env.HYPRLAND_INSTANCE_SIGNATURE = "fixture-webapp";
  fixture.env.HYPR_CLIENTS = JSON.stringify(clients);
  fixture.env.HYPR_FOCUS_RESPONSE = focusResponse;
  fixture.env.HYPR_LOG = join(fixture.root, "hyprctl.jsonl");
  writeFileSync(join(fixture.bin, "hyprctl"), `#!${process.execPath}
import { appendFileSync } from "node:fs";
const args = Bun.argv.slice(2);
appendFileSync(process.env.HYPR_LOG, JSON.stringify(args) + "\\n");
console.log(args[0] === "-j" ? process.env.HYPR_CLIENTS : process.env.HYPR_FOCUS_RESPONSE);
`, { mode: 0o755 });
}

async function browserArguments() {
  const deadline = Date.now() + 2000;
  while (!existsSync(fixture.env.CHROME_LOG!) && Date.now() < deadline) await Bun.sleep(10);
  return JSON.parse(readFileSync(fixture.env.CHROME_LOG!, "utf8")) as string[];
}

test("default launch focuses the most recently used matching window without spawning Chromium", async () => {
  const app = installedApp("YouTube");
  mockHyprland([
    { address: "0xa", class: app.id + "-other", pid: 10, mapped: true, focusHistoryID: 0 },
    { address: "0xb", class: app.id, pid: 20, mapped: true, focusHistoryID: 4 },
    { address: "0xc", class: "changed", initialClass: app.id, pid: 30, mapped: true, focusHistoryID: 1 },
    { address: "0xd", class: app.id, pid: 40, mapped: false, focusHistoryID: 0 },
  ]);
  expect(data(await Luna.webapp.launch(app.name, { env: fixture.env }))).toEqual({
    ...app, action: "focused", pid: 30, windowAddress: "0xc",
  });
  expect(existsSync(fixture.env.CHROME_LOG!)).toBe(false);
  const commands = readFileSync(fixture.env.HYPR_LOG!, "utf8")
    .trim().split("\n").map((line) => JSON.parse(line));
  expect(commands).toEqual([
    ["-j", "clients"],
    ["dispatch", 'hl.dsp.focus({ window = "address:0xc" })'],
  ]);
});

test("launch opens Chromium when no mapped window matches", async () => {
  const app = installedApp("YouTube");
  mockHyprland([{ address: "0xa", class: app.id, pid: 10, mapped: false }]);
  const result = data(await Luna.webapp.launch(app.name, { env: fixture.env }));
  expect(result.action).toBe("opened");
  expect(result.pid).toBeGreaterThan(0);
  expect(await browserArguments()).toContain(`--class=${app.id}`);
  expect(readFileSync(fixture.env.HYPR_LOG!, "utf8")).toBe('["-j","clients"]\n');
});

test("focusExisting false bypasses compositor discovery and requests a new browser window", async () => {
  const app = installedApp("YouTube");
  mockHyprland([{ address: "0xa", class: app.id, pid: 10 }]);
  const result = data(await Luna.webapp.launch(app.name, { env: fixture.env, focusExisting: false }));
  expect(result.action).toBe("opened");
  expect(await browserArguments()).toContain("--new-window");
  expect(existsSync(fixture.env.HYPR_LOG!)).toBe(false);
});

test("a rejected focus request fails without opening a duplicate app", async () => {
  const app = installedApp("YouTube");
  mockHyprland([{ address: "0xa", class: app.id, pid: 10 }], "window disappeared");
  expect(await Luna.webapp.launch(app.name, { env: fixture.env })).toMatchObject({
    succes: false, err: "COMMAND_FAILED",
  });
  expect(existsSync(fixture.env.CHROME_LOG!)).toBe(false);
});

test("invalid compositor data and unavailable Hyprctl do not silently open duplicates", async () => {
  const app = installedApp("YouTube");
  fixture.env.HYPRLAND_INSTANCE_SIGNATURE = "fixture-webapp";
  expect(await Luna.webapp.launch(app.name, { env: fixture.env })).toMatchObject({
    succes: false, err: "INVALID_ENVIRONMENT",
  });
  mockHyprland([{ address: '0xa" })', class: app.id, pid: 10 }]);
  expect(await Luna.webapp.launch(app.name, { env: fixture.env })).toMatchObject({
    succes: false, err: "COMMAND_FAILED",
  });
  fixture.env.HYPR_CLIENTS = "not JSON";
  expect(await Luna.webapp.launch(app.name, { env: fixture.env })).toMatchObject({
    succes: false, err: "COMMAND_FAILED",
  });
  expect(existsSync(fixture.env.CHROME_LOG!)).toBe(false);
});

test("exact names launch without fzf, while fuzzy false rejects abbreviations", async () => {
  const app = installedApp("YouTube");
  expect(await Luna.webapp.launch("ytb", { env: fixture.env, fuzzy: false })).toMatchObject({
    succes: false, err: "INVALID_ARGUMENT",
  });
  expect(await Luna.webapp.launch("ytb", { env: fixture.env })).toMatchObject({
    succes: false, err: "INVALID_ENVIRONMENT",
  });
  expect(existsSync(fixture.env.CHROME_LOG!)).toBe(false);
  expect(data(await Luna.webapp.launch(app.name, { env: fixture.env })).name).toBe(app.name);
  await browserArguments();
});

test.skipIf(!Bun.which("fzf"))("fzf selects a case-insensitive fuzzy match without inheriting user defaults", async () => {
  installedApp("YouTube Music");
  const app = installedApp("YouTube");
  installedApp("GitHub");
  symlinkSync(Bun.which("fzf")!, join(fixture.bin, "fzf"));
  fixture.env.FZF_DEFAULT_OPTS = "--filter=GitHub --print-query --no-sort";
  fixture.env.FZF_DEFAULT_OPTS_FILE = join(fixture.root, "unreadable-fzf-options");
  const result = data(await Luna.webapp.launch("YTB", { env: fixture.env }));
  expect(result.name).toBe(app.name);
  expect(await browserArguments()).toContain(`--class=${app.id}`);
});

test.skipIf(!Bun.which("fzf"))("no fuzzy match returns an error without spawning Chromium", async () => {
  installedApp("YouTube");
  symlinkSync(Bun.which("fzf")!, join(fixture.bin, "fzf"));
  expect(await Luna.webapp.launch("zzzz", { env: fixture.env })).toMatchObject({
    succes: false, err: "INVALID_ARGUMENT",
  });
  expect(existsSync(fixture.env.CHROME_LOG!)).toBe(false);
});
