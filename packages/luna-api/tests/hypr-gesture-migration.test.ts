import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrationPlan } from "../src/self/migrations/plan.ts";

test("gesture migration refreshes only Hyprland and propagates configuration/reload failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "luna-gesture-migration-"));
  try {
    const plan = await migrationPlan({
      repository: new URL("../../../", import.meta.url).pathname,
      from: "0.0.9",
      to: "0.0.10",
    });
    expect(plan).toHaveLength(1);
    const script = join(root, "migrations/v0.0.9-v0.0.10.ts");
    await Bun.write(script, Bun.file(plan[0]!.path));
    await Bun.write(
      join(root, "packages/luna-api/src/index.ts"),
      `
      import { appendFileSync } from 'node:fs';
      export const Luna = { apps: { configure: async ids => {
        appendFileSync(Bun.env.FIXTURE_LOG, 'configure:' + ids + '\\n');
        return { succes: Bun.env.FIXTURE_FAIL !== 'configure', errMessage: 'fixture failure' };
      } } };
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
    expect(await run("configure")).toEqual({ code: 1, calls: "configure:hypr\n" });
    expect(await run("reload")).toEqual({ code: 1, calls: "configure:hypr\nreload\n" });
    for (let attempt = 0; attempt < 2; attempt++)
      expect(await run("")).toEqual({ code: 0, calls: "configure:hypr\nreload\n" });
    expect(await run("", false)).toEqual({ code: 0, calls: "configure:hypr\n" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
