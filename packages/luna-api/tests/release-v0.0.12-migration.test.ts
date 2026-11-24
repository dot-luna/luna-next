import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrationPlanner } from "../src/modules/self/migrations/plan.ts";

test("v0.0.12 refreshes only an installed bar, retries safely and propagates failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "luna-v0.0.12-migration-"));
  try {
    const plan = await migrationPlanner.plan({
      repository: new URL("../../../", import.meta.url).pathname,
      from: "0.0.11",
      to: "0.0.12",
    });
    expect(plan).toHaveLength(1);
    const script = join(root, "migrations/v0.0.11-v0.0.12.ts");
    await Bun.write(script, Bun.file(plan[0]!.path));
    await Bun.write(
      join(root, "packages/luna-api/src/index.ts"),
      `import {appendFileSync} from 'node:fs';
      export const Luna = {apps: {
        installed: async names => ({succes: Bun.env.FIXTURE_FAIL !== 'query',
          data: Bun.env.FIXTURE_INSTALLED === 'yes' ? names : [], errMessage: 'query failure'}),
        install: async (ids, options) => {
          appendFileSync(Bun.env.FIXTURE_LOG, JSON.stringify({ids, options}) + '\\n');
          return {succes: Bun.env.FIXTURE_FAIL !== 'install', errMessage: 'install failure'};
        }
      }};`,
    );
    const log = join(root, "calls");
    async function run(installed = true, failure = "") {
      await Bun.write(log, "");
      const result = Bun.spawnSync([process.execPath, script], {
        env: {
          HOME: root,
          FIXTURE_LOG: log,
          FIXTURE_INSTALLED: installed ? "yes" : "no",
          FIXTURE_FAIL: failure,
        },
      });
      return { code: result.exitCode, calls: (await Bun.file(log).text()).trim() };
    }
    const calls = JSON.stringify({ ids: ["luna-bar"], options: { closeApps: false } });
    for (let attempt = 0; attempt < 2; attempt++) expect(await run()).toEqual({ code: 0, calls });
    expect(await run(false)).toEqual({ code: 0, calls: "" });
    expect(await run(true, "query")).toEqual({ code: 1, calls: "" });
    expect(await run(true, "install")).toEqual({ code: 1, calls });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
