import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrationPlanner } from "../src/modules/self/migrations/plan.ts";

test("bar upgrade stops on failure, retries safely, and only starts inside Hyprland", async () => {
  const root = await mkdtemp(join(tmpdir(), "luna-bar-migration-"));
  try {
    const plan = await migrationPlanner.plan({
      repository: new URL("../../../", import.meta.url).pathname,
      from: "0.0.8",
      to: "0.0.9",
    });
    expect(plan).toHaveLength(1);
    const script = join(root, "migrations/v0.0.8-v0.0.9.ts");
    await Bun.write(script, Bun.file(plan[0]!.path));
    await Bun.write(
      join(root, "packages/luna-api/src/index.ts"),
      `
      import {appendFileSync} from 'node:fs';
      function call(name) {
        appendFileSync(Bun.env.FIXTURE_LOG, name + '\\n');
        return {succes: name !== Bun.env.FIXTURE_FAIL, errMessage: 'fixture failure'};
      }
      export const Luna = {
        apps: {install: async ids => call('install:' + ids), configure: async ids => call('configure:' + ids)},
        bar: {start: async () => call('start')},
      };
    `,
    );
    const hyprctl = join(root, "bin/hyprctl");
    await Bun.write(
      hyprctl,
      `#!${process.execPath}
      import {appendFileSync} from 'node:fs';
      appendFileSync(Bun.env.FIXTURE_LOG, Bun.argv.slice(2).join(' ') + '\\n');
      process.exit(Bun.env.FIXTURE_FAIL === 'reload' ? 1 : 0);
    `,
    );
    await chmod(hyprctl, 0o755);
    const log = join(root, "calls");
    async function run(failure: string, session = true) {
      await Bun.write(log, "");
      const result = Bun.spawnSync([process.execPath, script], {
        env: {
          HOME: root,
          PATH: join(root, "bin"),
          HYPRLAND_INSTANCE_SIGNATURE: session ? "fixture" : "",
          FIXTURE_LOG: log,
          FIXTURE_FAIL: failure,
        },
      });
      return { code: result.exitCode, calls: await Bun.file(log).text() };
    }
    expect(await run("install:luna-bar")).toEqual({ code: 1, calls: "install:luna-bar\n" });
    expect(await run("configure:hypr")).toEqual({
      code: 1,
      calls: "install:luna-bar\nconfigure:hypr\n",
    });
    expect(await run("reload")).toEqual({
      code: 1,
      calls: "install:luna-bar\nconfigure:hypr\nreload\n",
    });
    expect((await run("start")).code).toBe(1);
    for (let attempt = 0; attempt < 2; attempt++)
      expect(await run("")).toEqual({
        code: 0,
        calls: "install:luna-bar\nconfigure:hypr\nreload\nstart\n",
      });
    expect(await run("", false)).toEqual({ code: 0, calls: "install:luna-bar\nconfigure:hypr\n" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
