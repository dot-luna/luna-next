import { expect, test } from "bun:test";
import { resolve } from "node:path";

test.each([
  { wayland: true, failure: "", expected: ["install", "configure", "start"] },
  { wayland: false, failure: "", expected: ["install", "configure"] },
  { wayland: true, failure: "install", expected: ["install"] },
  { wayland: true, failure: "configure", expected: ["install", "configure"] },
  { wayland: true, failure: "start", expected: ["install", "configure", "start"] },
])("clipboard migration limits updates and stops on failure: %j", async (scenario) => {
  // Stub every operation in a child process; importing the migration never touches this session.
  const script = `
    import { Luna } from ${JSON.stringify(resolve(import.meta.dir, "../src/index.ts"))};
    const calls = [];
    for (const [api, method] of [[Luna.apps, "install"], [Luna.apps, "configure"], [Luna.clipboard, "start"]]) {
      api[method] = async (...args) => {
        calls.push({method, args});
        return method === ${JSON.stringify(scenario.failure)}
          ? {succes: false, errMessage: "fixture failure"} : {succes: true};
      };
    }
    try { await import(${JSON.stringify(resolve(import.meta.dir, "../../../migrations/v0.0.5-v0.0.6.ts"))}); }
    catch { process.exitCode = 1; }
    console.log(JSON.stringify(calls));
  `;
  const child = Bun.spawn([process.execPath, "--eval", script], {
    env: { ...Bun.env, WAYLAND_DISPLAY: scenario.wayland ? "fixture-wayland" : "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const calls = JSON.parse(await new Response(child.stdout).text());
  expect(await child.exited).toBe(scenario.failure ? 1 : 0);
  expect(calls.map((call: { method: string }) => call.method)).toEqual(scenario.expected);
  expect(calls[0].args).toEqual([["luna-menu"]]);
  if (calls[1]) expect(calls[1].args).toEqual([["hypr"]]);
});
