import { expect, test } from "bun:test";
import { resolve } from "node:path";

test.each([
  { hyprland: true, failure: "", expected: ["configure", "reload"] },
  { hyprland: false, failure: "", expected: ["configure"] },
  { hyprland: true, failure: "configure", expected: ["configure"] },
  { hyprland: true, failure: "reload", expected: ["configure", "reload"] },
  { hyprland: true, failure: "spawn", expected: ["configure", "reload"] },
])("v0.0.8 refreshes changed apps and propagates failures: %j", async (scenario) => {
  // Stub both app configuration and process execution before importing a live-session migration.
  const script = `
    import { Luna } from ${JSON.stringify(resolve(import.meta.dir, "../src/index.ts"))};
    const calls = [];
    const failure = ${JSON.stringify(scenario.failure)};
    Luna.apps.configure = async (...args) => {
      calls.push({method: "configure", args});
      return failure === "configure" ? {succes: false, errMessage: "fixture failure"} : {succes: true};
    };
    Bun.spawn = (args) => {
      calls.push({method: "reload", args});
      if (failure === "spawn") throw new Error("fixture missing hyprctl");
      return {exited: Promise.resolve(failure === "reload" ? 1 : 0)};
    };
    try { await import(${JSON.stringify(resolve(import.meta.dir, "../../../migrations/v0.0.7-v0.0.8.ts"))}); }
    catch { process.exitCode = 1; }
    console.log(JSON.stringify(calls));
  `;
  const child = Bun.spawn([process.execPath, "--eval", script], {
    env: {
      ...Bun.env,
      WAYLAND_DISPLAY: "fixture-wayland",
      HYPRLAND_INSTANCE_SIGNATURE: scenario.hyprland ? "fixture-hyprland" : "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const calls = JSON.parse(await new Response(child.stdout).text());
  expect(await child.exited).toBe(scenario.failure ? 1 : 0);
  expect(calls.map((call: { method: string }) => call.method)).toEqual(scenario.expected);
  expect(calls[0].args).toEqual([["luna-menu", "hypr"]]);
  if (calls[1]) expect(calls[1].args).toEqual(["hyprctl", "reload"]);
});

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

test.each([false, true])(
  "v0.0.7 refreshes only menu and Hyprland, propagating failure=%s",
  async (failure) => {
    const script = `
    import { Luna } from ${JSON.stringify(resolve(import.meta.dir, "../src/index.ts"))};
    Luna.apps.configure = async (names) => {
      console.log(JSON.stringify(names));
      return ${JSON.stringify(failure)} ? {succes: false, errMessage: "fixture failure"} : {succes: true};
    };
    try { await import(${JSON.stringify(resolve(import.meta.dir, "../../../migrations/v0.0.6-v0.0.7.ts"))}); }
    catch { process.exitCode = 1; }
  `;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(JSON.parse(await new Response(child.stdout).text())).toEqual(["luna-menu", "hypr"]);
    expect(await child.exited).toBe(failure ? 1 : 0);
  },
);
