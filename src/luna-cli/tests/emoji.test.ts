import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let directory: string;
let log: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "luna emoji cli "));
  log = join(directory, "calls.jsonl");
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

/** Stub API side effects in a child; arguments, output, and exit codes stay real. */
async function cli({ args, response }: { args: string[]; response: unknown }) {
  const script = `
import { appendFileSync } from "node:fs";
import { Luna } from ${JSON.stringify(resolve(import.meta.dir, "../../../packages/luna-api/src/index.ts"))};
import { runCli } from ${JSON.stringify(resolve(import.meta.dir, "../src/cli.ts"))};
for (const method of ["list", "copy", "paste"]) {
  Luna.emoji[method] = async (...args) => {
    appendFileSync(process.env.LUNA_TEST_LOG, JSON.stringify({method, args}) + "\\n");
    return JSON.parse(process.env.LUNA_TEST_RESPONSE);
  };
}
Luna.menu.emoji = async (...args) => {
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

test("emoji and menu emoji open the picker", async () => {
  const response = { succes: true, data: { running: true } };
  for (const args of [["emoji"], ["menu", "emoji"]]) {
    const result = await cli({ args: [...args, "--install-dir", "/checkout", "--json"], response });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(response);
    expect(calls().at(-1)).toEqual({ method: "show", args: [{ repository: "/checkout" }] });
  }
});

test("emoji commands preserve queries, ordered selections and the saved target", async () => {
  const response = { succes: true, data: { text: "😀❤️😀" } };
  expect(
    (
      await cli({
        args: ["emoji", "paste", "😀", "❤️", "😀", "--target", "0xabc", "--json"],
        response,
      })
    ).code,
  ).toBe(0);
  expect(calls().at(-1)).toEqual({
    method: "paste",
    args: [["😀", "❤️", "😀"], { target: "0xabc" }],
  });
  expect((await cli({ args: ["emoji", "copy", "❤️"], response })).stdout).toBe("Copied\n");
  expect(calls().at(-1)).toEqual({ method: "copy", args: [["❤️"]] });
  await cli({
    args: ["emoji", "list", "red heart", "--json"],
    response: { succes: true, data: [] },
  });
  expect(calls().at(-1)).toEqual({ method: "list", args: ["red heart"] });
});

test("emoji argument and API failures return unsuccessful exit codes", async () => {
  for (const args of [
    ["emoji", "paste"],
    ["emoji", "copy"],
    ["emoji", "--invalid"],
  ])
    expect((await cli({ args, response: {} })).code).toBe(2);
  expect(calls()).toEqual([]);
  const response = { succes: false, err: "CONFLICT", errMessage: "Focus changed" };
  const result = await cli({ args: ["emoji", "paste", "😀", "--json"], response });
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout)).toEqual(response);
});
