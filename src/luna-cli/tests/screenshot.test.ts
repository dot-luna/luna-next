import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const api = resolve(import.meta.dir, "../../../packages/luna-api/src/index.ts");
const entry = resolve(import.meta.dir, "../src/cli.ts");
let root: string;
let log: string;

async function cli(args: string[], response: unknown) {
  // Stub the API boundary in a child so CLI output and exit codes remain real.
  const script = `
import { appendFileSync } from "node:fs";
import { Luna } from ${JSON.stringify(api)};
import { runCli } from ${JSON.stringify(entry)};
Luna.screenshot.capture = async (mode, options) => {
  appendFileSync(process.env.LUNA_SCREENSHOT_TEST_LOG, JSON.stringify({mode, options}) + "\\n");
  return JSON.parse(process.env.LUNA_SCREENSHOT_TEST_RESPONSE);
};
Luna.screenshot.extractText = async (options) => {
  appendFileSync(process.env.LUNA_SCREENSHOT_TEST_LOG, JSON.stringify({mode: "text", options}) + "\\n");
  return JSON.parse(process.env.LUNA_SCREENSHOT_TEST_RESPONSE);
};
process.exitCode = await runCli(JSON.parse(process.env.LUNA_SCREENSHOT_TEST_ARGUMENTS));
`;
  const child = Bun.spawn([process.execPath, "--eval", script], {
    env: {
      NO_COLOR: "1",
      LUNA_SCREENSHOT_TEST_LOG: log,
      LUNA_SCREENSHOT_TEST_ARGUMENTS: JSON.stringify(["screenshot", ...args]),
      LUNA_SCREENSHOT_TEST_RESPONSE: JSON.stringify(response),
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

function calls(): { mode: string; options: { directory?: string; configFile?: string } }[] {
  try {
    return readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "luna screenshot cli ' "));
  log = join(root, "captures.jsonl");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

test("screenshot defaults to region and forwards each capture mode and directory unchanged", async () => {
  const path = join(root, "Saved screenshot.png");
  const response = { succes: true, data: { cancelled: false, path } };
  expect(await cli([], response)).toEqual({ stdout: `${path}\n`, stderr: "", exitCode: 0 });
  for (const mode of ["region", "screen", "window", "all"]) {
    const directory = join(root, `images ${mode}`);
    const result = await cli([mode, "--directory", directory, "--json"], response);
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual(response);
    expect(calls().at(-1)).toEqual({ mode, options: { directory } });
  }
  expect(calls()[0]).toEqual({ mode: "region", options: {} });
});

test("screenshot cancellation is silent for humans and remains an unchanged JSON success", async () => {
  const response = { succes: true, data: { cancelled: true, path: null } };
  expect(await cli([], response)).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  expect(await cli(["--json"], response)).toEqual({
    stdout: JSON.stringify(response) + "\n",
    stderr: "",
    exitCode: 0,
  });
});

test("screenshot reports capture failures and rejects invalid arguments before calling the API", async () => {
  const response = { succes: false, err: "COMMAND_FAILED", errMessage: "Capture failed" };
  const human = await cli([], response);
  expect(human.exitCode).toBe(1);
  expect(human.stdout).toBe("");
  expect(human.stderr).toContain("Capture failed");
  expect(await cli(["--json"], response)).toEqual({
    stdout: JSON.stringify(response) + "\n",
    stderr: "",
    exitCode: 1,
  });
  const count = calls().length;
  for (const args of [["unsupported"], ["screen", "extra"], ["--directory"]]) {
    const result = await cli([...args, "--json"], response);
    expect(result.exitCode, result.stdout + result.stderr).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({ succes: false, err: "INVALID_ARGUMENT" });
  }
  expect(calls()).toHaveLength(count);
});

test("text extraction forwards settings and prints text or the unchanged JSON response", async () => {
  const response = { succes: true, data: { cancelled: false, text: "Website text\nSecond line" } };
  expect(await cli(["text"], response)).toEqual({
    stdout: "Website text\nSecond line\n",
    stderr: "",
    exitCode: 0,
  });
  expect(calls().at(-1)).toEqual({ mode: "text", options: {} });
  const configFile = join(root, "settings.jsonc");
  expect(await cli(["text", "--config", configFile, "--json"], response)).toEqual({
    stdout: JSON.stringify(response) + "\n",
    stderr: "",
    exitCode: 0,
  });
  expect(calls().at(-1)).toEqual({ mode: "text", options: { configFile } });
  for (const data of [
    { cancelled: true, text: null },
    { cancelled: false, text: "" },
  ]) {
    expect(await cli(["text"], { succes: true, data })).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    expect(JSON.parse((await cli(["text", "--json"], { succes: true, data })).stdout)).toEqual({
      succes: true,
      data,
    });
  }
});

test("text extraction reports failures and rejects incompatible capture options", async () => {
  const response = { succes: false, err: "COMMAND_FAILED", errMessage: "OCR failed" };
  const result = await cli(["text"], response);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("OCR failed");
  for (const args of [
    ["text", "--directory", root],
    ["region", "--config", root],
  ]) {
    expect((await cli(args, response)).exitCode).toBe(2);
  }
  expect(calls()).toHaveLength(1);
});
