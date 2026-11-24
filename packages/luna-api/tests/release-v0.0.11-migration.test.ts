import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrationPlanner } from "../src/modules/self/migrations/plan.ts";

test("v0.0.11 migration refreshes only installed changed apps in order and propagates failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "luna-v0.0.11-migration-"));
  try {
    const plan = await migrationPlanner.plan({
      repository: new URL("../../../", import.meta.url).pathname,
      from: "0.0.10",
      to: "0.0.11",
    });
    expect(plan).toHaveLength(1);
    const script = join(root, "migrations/v0.0.10-v0.0.11.ts");
    await Bun.write(script, Bun.file(plan[0]!.path));
    // The fixture API logs calls; FIXTURE_INSTALLED lists installed apps and FIXTURE_FAIL a failing call.
    await Bun.write(
      join(root, "packages/luna-api/src/index.ts"),
      `
      import { appendFileSync } from 'node:fs';
      const log = (call) => {
        appendFileSync(Bun.env.FIXTURE_LOG, call + '\\n');
        return { succes: Bun.env.FIXTURE_FAIL !== call, errMessage: 'fixture failure' };
      };
      const installed = (Bun.env.FIXTURE_INSTALLED ?? '').split(',').filter(Boolean);
      export const Luna = {
        apps: {
          installed: async (names) => ({ succes: true, data: names.filter((name) => installed.includes(name)) }),
          configure: async (ids, options) => log('configure:' + ids + (options.closeApps ? '' : ':open')),
        },
        theme: {
          mode: async (mode) => mode ? { ...log('mode:' + mode), data: mode } : { succes: true, data: 'dark' },
        },
      };
    `,
    );
    const hyprctl = join(root, "bin/hyprctl");
    await Bun.write(
      hyprctl,
      `#!${process.execPath}
      import { appendFileSync } from 'node:fs';
      appendFileSync(Bun.env.FIXTURE_LOG, Bun.argv.slice(2).join(' ') + '\\n');
      process.exit(Bun.env.FIXTURE_FAIL === 'reload' ? 1 : 0);
    `,
    );
    await chmod(hyprctl, 0o755);
    const log = join(root, "calls");
    async function run({
      installed = "hypr,fastfetch,luna-bar,t3code,zen,chromium",
      failure = "",
      session = true,
    } = {}) {
      await Bun.write(log, "");
      const result = Bun.spawnSync([process.execPath, script], {
        env: {
          HOME: root,
          PATH: join(root, "bin"),
          HYPRLAND_INSTANCE_SIGNATURE: session ? "fixture" : "",
          FIXTURE_LOG: log,
          FIXTURE_FAIL: failure,
          FIXTURE_INSTALLED: installed,
        },
      });
      return { code: result.exitCode, calls: (await Bun.file(log).text()).trim().split("\n") };
    }
    const all = [
      "configure:hypr,fastfetch",
      "reload",
      "configure:luna-bar",
      "mode:dark",
      "configure:t3code:open",
      "configure:zen,chromium",
    ];
    // Repeating the migration is safe and refreshes the same apps.
    for (let attempt = 0; attempt < 2; attempt++)
      expect(await run()).toEqual({ code: 0, calls: all });
    expect(await run({ installed: "hypr,chromium", session: false })).toEqual({
      code: 0,
      calls: ["configure:hypr", "mode:dark", "configure:chromium"],
    });
    expect(await run({ failure: "configure:hypr,fastfetch" })).toEqual({
      code: 1,
      calls: ["configure:hypr,fastfetch"],
    });
    expect(await run({ failure: "reload" })).toEqual({ code: 1, calls: all.slice(0, 2) });
    expect(await run({ failure: "configure:luna-bar" })).toEqual({
      code: 1,
      calls: all.slice(0, 3),
    });
    expect(await run({ failure: "mode:dark" })).toEqual({ code: 1, calls: all.slice(0, 4) });
    expect(await run({ failure: "configure:zen,chromium" })).toEqual({ code: 1, calls: all });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
