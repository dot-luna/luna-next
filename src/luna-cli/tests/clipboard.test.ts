import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let directory: string;
let log: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "luna clipboard cli "));
  log = join(directory, "calls.jsonl");
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

/** Stub API side effects in a child; arguments, output, and exit codes stay real. */
async function cli({ args, response }: { args: string[]; response: unknown }) {
  const script = `
import { appendFileSync } from "node:fs";
import { Luna } from ${JSON.stringify(resolve(import.meta.dir, "../../../packages/luna-api/src/index.ts"))};
import { runCli } from ${JSON.stringify(resolve(import.meta.dir, "../src/cli.ts"))};
for (const method of ["start", "list", "preview", "copy", "paste", "target", "delete", "clear"]) {
  Luna.clipboard[method] = async (...args) => {
    appendFileSync(process.env.LUNA_TEST_LOG, JSON.stringify({method, args}) + "\\n");
    return JSON.parse(process.env.LUNA_TEST_RESPONSE);
  };
}
Luna.menu.clipboard = async (...args) => {
  appendFileSync(process.env.LUNA_TEST_LOG, JSON.stringify({method:"show", args}) + "\\n");
  return JSON.parse(process.env.LUNA_TEST_RESPONSE);
};
process.exitCode = await runCli(JSON.parse(process.env.LUNA_TEST_ARGS));
`;
  const child = Bun.spawn([process.execPath, "--eval", script], {
    env: {
      HOME: directory,
      NO_COLOR: "1",
      LUNA_TEST_LOG: log,
      LUNA_TEST_ARGS: JSON.stringify(args),
      LUNA_TEST_RESPONSE: JSON.stringify(response),
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}
function calls() {
  return existsSync(log)
    ? readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
    : [];
}

test("clipboard and menu clipboard open the view with the explicit checkout", async () => {
  const response = { succes: true, data: { running: true, shellDirectory: "/shell" } };
  for (const args of [["clipboard"], ["menu", "clipboard"]]) {
    expect(
      (await cli({ args: [...args, "--install-dir", "/checkout", "--json"], response })).stdout,
    ).toBe(JSON.stringify(response) + "\n");
    expect(calls().at(-1)).toEqual({ method: "show", args: [{ repository: "/checkout" }] });
  }
});

test("paste forwards a saved window address and copy has no paste side effect", async () => {
  const response = { succes: true, data: { id: "12" } };
  expect(await cli({ args: ["clipboard", "paste", "12", "--target", "0xabc"], response })).toEqual({
    stdout: "Pasted\n",
    stderr: "",
    code: 0,
  });
  expect(calls().at(-1)).toEqual({ method: "paste", args: ["12", { target: "0xabc" }] });
  expect(await cli({ args: ["clipboard", "copy", "12"], response })).toEqual({
    stdout: "Copied\n",
    stderr: "",
    code: 0,
  });
  expect(calls().at(-1)).toEqual({ method: "copy", args: ["12"] });
});

test("list, preview, target and lifecycle commands preserve API JSON", async () => {
  for (const args of [
    ["list"],
    ["preview", "12"],
    ["target"],
    ["delete", "12"],
    ["clear"],
    ["start"],
  ]) {
    const response = {
      succes: true,
      data:
        args[0] === "list"
          ? [{ id: "12", name: "literal $HOME" }]
          : { id: "12", text: "full\ntext" },
    };
    expect(await cli({ args: ["clipboard", ...args, "--json"], response })).toEqual({
      stdout: JSON.stringify(response) + "\n",
      stderr: "",
      code: 0,
    });
    expect(calls().at(-1)).toEqual({ method: args[0], args: args.slice(1) });
  }
});

test("missing IDs and unknown flags fail before calling the API", async () => {
  for (const args of [
    ["paste"],
    ["preview"],
    ["copy"],
    ["delete"],
    ["copy", "12", "--target", "0xabc"],
  ]) {
    const result = await cli({ args: ["clipboard", ...args, "--json"], response: {} });
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ succes: false, err: "INVALID_ARGUMENT" });
  }
  expect(calls()).toEqual([]);
});

test("paste failures return the API error unchanged with a failing exit code", async () => {
  const response = {
    succes: false,
    err: "CONFLICT",
    errMessage: "Copied, but focus changed; paste manually",
  };
  expect(await cli({ args: ["clipboard", "paste", "12", "--json"], response })).toEqual({
    stdout: JSON.stringify(response) + "\n",
    stderr: "",
    code: 1,
  });
});
