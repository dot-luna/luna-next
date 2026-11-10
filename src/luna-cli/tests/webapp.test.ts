import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const apiEntry = resolve(import.meta.dir, "../../../packages/luna-api/src/index.ts");
const cliEntry = resolve(import.meta.dir, "../src/cli.ts");
let directory: string;
let logPath: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "luna webapp cli "));
  logPath = join(directory, "api-calls.jsonl");
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

/** Stub the API in a child process; parsing and output stay real without opening apps or windows. */
async function cli(args: string[], response: unknown) {
  const script = `
import { appendFileSync } from "node:fs";
import { Luna } from ${JSON.stringify(apiEntry)};
import { runCli } from ${JSON.stringify(cliEntry)};
for (const method of ["install", "launch", "list", "uninstall"]) {
  Luna.webapp[method] = async (...args) => {
    appendFileSync(process.env.LUNA_WEBAPP_TEST_LOG, JSON.stringify({ method, args }) + "\\n");
    return JSON.parse(process.env.LUNA_WEBAPP_TEST_RESPONSE);
  };
}
process.exitCode = await runCli(JSON.parse(process.env.LUNA_WEBAPP_TEST_ARGUMENTS));
`;
  const child = Bun.spawn([process.execPath, "--eval", script], {
    env: {
      NO_COLOR: "1",
      LUNA_WEBAPP_TEST_LOG: logPath,
      LUNA_WEBAPP_TEST_RESPONSE: JSON.stringify(response),
      LUNA_WEBAPP_TEST_ARGUMENTS: JSON.stringify(["webapp", ...args]),
    },
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

function calls(): { method: string; args: unknown[] }[] {
  try {
    return readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

const app = { name: "YouTube", url: "https://youtube.com/", id: "luna-webapp-test" };

test("install forwards local and remote icons with shared path overrides and unchanged JSON", async () => {
  const response = { succes: true, data: { ...app, desktopFile: "/apps/youtube.desktop" } };
  for (const icon of ["./custom icon.png", "https://example.test/logo.svg"]) {
    const result = await cli([
      "--data-dir", "/custom/data", "install", app.name, app.url,
      "--icon", icon, "--launcher", "/custom/luna", "--json",
    ], response);
    expect(result).toEqual({ stdout: JSON.stringify(response) + "\n", stderr: "", exitCode: 0 });
    expect(calls().at(-1)).toEqual({
      method: "install",
      args: [app.name, app.url, { dataDir: "/custom/data", launcher: "/custom/luna", icon }],
    });
  }
});

test("install leaves icon discovery to the API when no icon is provided", async () => {
  const response = { succes: true, data: app };
  expect(await cli(["install", app.name, app.url], response)).toEqual({
    stdout: "Installed web app: YouTube\n", stderr: "", exitCode: 0,
  });
  expect(calls().at(-1)).toEqual({ method: "install", args: [app.name, app.url, {}] });
});

test("launch defaults focus and fuzzy to true and reports a focused app", async () => {
  const response = { succes: true, data: { ...app, action: "focused", pid: 10, windowAddress: "0xa" } };
  expect(await cli(["launch", "ytb"], response)).toEqual({
    stdout: "Focused web app: YouTube\n", stderr: "", exitCode: 0,
  });
  expect(calls().at(-1)).toEqual({
    method: "launch", args: ["ytb", { focusExisting: true, fuzzy: true }],
  });
});

test("launch negated flags and shared options reach the API, and opened JSON remains unchanged", async () => {
  const response = { succes: true, data: { ...app, action: "opened", pid: 20 } };
  const args = ["launch", app.name, "--no-focus-existing", "--no-fuzzy", "--chromium", "/custom/chromium"];
  expect(await cli(args, response)).toEqual({
    stdout: "Opened web app: YouTube\n", stderr: "", exitCode: 0,
  });
  expect(calls().at(-1)).toEqual({
    method: "launch",
    args: [app.name, { chromium: "/custom/chromium", focusExisting: false, fuzzy: false }],
  });
  expect(await cli([...args, "--json"], response)).toEqual({
    stdout: JSON.stringify(response) + "\n", stderr: "", exitCode: 0,
  });
});

test("missing JSON install inputs and invalid flags fail before calling the API", async () => {
  const response = { succes: true, data: app };
  const missing = await cli(["install", "--json"], response);
  expect(missing.exitCode).toBe(1);
  expect(JSON.parse(missing.stdout)).toMatchObject({ succes: false, err: "INPUT_REQUIRED" });
  for (const args of [["install", app.name, app.url, "--icon"], ["launch", app.name, "--unknown"]]) {
    const result = await cli([...args, "--json"], response);
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ succes: false, err: "INVALID_ARGUMENT" });
  }
  expect(calls()).toEqual([]);
});

test("launch failures retain the API error and unsuccessful exit code", async () => {
  const response = { succes: false, err: "COMMAND_FAILED", errMessage: "Cannot focus app window" };
  expect(await cli(["launch", app.name, "--json"], response)).toEqual({
    stdout: JSON.stringify(response) + "\n", stderr: "", exitCode: 1,
  });
});
