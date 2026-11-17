import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const apiEntry = resolve(import.meta.dir, "../../../packages/luna-api/src/index.ts");
const cliEntry = resolve(import.meta.dir, "../src/cli.ts");
let directory: string;
let logPath: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "luna apps cli "));
  logPath = join(directory, "calls.jsonl");
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

/** Run real argument parsing and output with API operations stubbed in an isolated process. */
async function cli({ args, response }: { args: string[]; response: unknown }) {
  const script = `
import { appendFileSync } from "node:fs";
import { Luna } from ${JSON.stringify(apiEntry)};
import { runCli } from ${JSON.stringify(cliEntry)};
for (const method of ["install", "configure", "update", "uninstall"]) {
  Luna.apps[method] = async (...args) => {
    appendFileSync(process.env.LUNA_APPS_TEST_LOG, JSON.stringify({ method, args }) + "\\n");
    return JSON.parse(process.env.LUNA_APPS_TEST_RESPONSE);
  };
}
process.exitCode = await runCli(JSON.parse(process.env.LUNA_APPS_TEST_ARGUMENTS));
`;
  const child = Bun.spawn([process.execPath, "--eval", script], {
    env: {
      HOME: directory,
      NO_COLOR: "1",
      LUNA_APPS_TEST_LOG: logPath,
      LUNA_APPS_TEST_RESPONSE: JSON.stringify(response),
      LUNA_APPS_TEST_ARGUMENTS: JSON.stringify(args),
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

function calls() {
  return existsSync(logPath)
    ? readFileSync(logPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
    : [];
}

const updated = {
  succes: true,
  data: { updated: ["kitty"], failed: [], completed: true, logDirectory: "/logs" },
};
const uninstalled = {
  succes: true,
  data: { uninstalled: ["kitty"], failed: [], completed: true, logDirectory: "/logs" },
};

test("update without names delegates installed-app selection to the API", async () => {
  expect(await cli({ args: ["update"], response: updated })).toEqual({
    stdout: "Updated: kitty\nLogs: /logs\n",
    stderr: "",
    exitCode: 0,
  });
  expect(calls()).toEqual([{ method: "update", args: [[], { closeApps: true }] }]);
});

test("update forwards names and its own flags with unchanged JSON output", async () => {
  expect(
    await cli({
      args: [
        "update",
        "kitty",
        "bat",
        "--install-dir",
        "/checkout",
        "--force",
        "--skip-failed",
        "--no-close-apps",
        "--json",
      ],
      response: updated,
    }),
  ).toEqual({
    stdout: JSON.stringify(updated) + "\n",
    stderr: "",
    exitCode: 0,
  });
  expect(calls()).toEqual([
    {
      method: "update",
      args: [
        ["kitty", "bat"],
        {
          repository: "/checkout",
          force: true,
          skipFailed: true,
          closeApps: false,
        },
      ],
    },
  ]);
});

test("uninstall keeps data by default and forwards an explicit purge", async () => {
  expect(await cli({ args: ["uninstall", "kitty"], response: uninstalled })).toEqual({
    stdout: "Uninstalled: kitty\nLogs: /logs\n",
    stderr: "",
    exitCode: 0,
  });
  expect(calls().at(-1)).toEqual({ method: "uninstall", args: [["kitty"], { closeApps: true }] });
  expect(
    (
      await cli({
        args: [
          "uninstall",
          "kitty",
          "bat",
          "--purge",
          "--install-dir",
          "/checkout",
          "--skip-failed",
          "--no-close-apps",
        ],
        response: uninstalled,
      })
    ).exitCode,
  ).toBe(0);
  expect(calls().at(-1)).toEqual({
    method: "uninstall",
    args: [
      ["kitty", "bat"],
      {
        repository: "/checkout",
        skipFailed: true,
        closeApps: false,
        purge: true,
      },
    ],
  });
});

test("missing uninstall names and flags belonging to the other command fail before the API", async () => {
  for (const args of [["uninstall"], ["uninstall", "kitty", "--force"], ["update", "--purge"]]) {
    const result = await cli({ args: [...args, "--json"], response: uninstalled });
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ succes: false, err: "INVALID_ARGUMENT" });
  }
  expect(calls()).toEqual([]);
});

test.each(["update", "uninstall"])(
  "%s reports partial failures with exit code 1 in text and JSON",
  async (operation) => {
    const response = {
      succes: true,
      data: {
        ...(operation === "update" ? { updated: [] } : { uninstalled: [] }),
        failed: [{ app: "kitty", error: "fixture failure", retry: `luna ${operation} kitty` }],
        completed: false,
        logDirectory: "/logs",
      },
    };
    expect(await cli({ args: [operation, "kitty", "--skip-failed"], response })).toEqual({
      stdout: `No apps changed.\nkitty failed: fixture failure\nRetry: luna ${operation} kitty\nLogs: /logs\n`,
      stderr: "",
      exitCode: 1,
    });
    expect(await cli({ args: [operation, "kitty", "--skip-failed", "--json"], response })).toEqual({
      stdout: JSON.stringify(response) + "\n",
      stderr: "",
      exitCode: 1,
    });
  },
);
