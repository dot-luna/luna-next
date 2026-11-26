import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrationPlanner } from "../src/modules/self/migrations/plan.ts";

test("v0.0.16 refreshes only installed Wallpaper exports through its lifecycle hooks", async () => {
  const root = await mkdtemp(join(tmpdir(), "luna-wallpaper-migration-"));
  try {
    const repository = new URL("../../../", import.meta.url).pathname;
    const [step] = await migrationPlanner.plan({ repository, from: "0.0.15", to: "0.0.16" });
    const script = join(root, "migrations/v0.0.15-v0.0.16.ts");
    await Bun.write(script, await Bun.file(step!.path).text());
    await Bun.write(
      join(root, "packages/luna-api/src/index.ts"),
      `
      export const Luna = { apps: {
        installed: async ids => {
          if (JSON.stringify(ids) !== '["luna-wallpaper"]') throw new Error('Unrelated app query');
          return {succes: Bun.env.FAIL !== 'query', data: JSON.parse(Bun.env.INSTALLED), errMessage: 'query failed'};
        },
        configure: async (ids, options) => {
          await Bun.write(Bun.env.LOG, JSON.stringify({ids, options}));
          return {succes: Bun.env.FAIL !== 'configure', errMessage: 'refresh failed'};
        }
      }};
    `,
    );
    const log = join(root, "calls");
    async function run(installed: string[], fail = "") {
      await Bun.write(log, "");
      const child = Bun.spawn([process.execPath, script], {
        env: { INSTALLED: JSON.stringify(installed), FAIL: fail, LOG: log },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, , stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      const source = await Bun.file(log).text();
      return { code, call: source ? JSON.parse(source) : null, stderr };
    }
    expect(await run([])).toMatchObject({ code: 0, call: null });
    for (let attempt = 0; attempt < 2; attempt++)
      expect(await run(["luna-wallpaper"])).toMatchObject({
        code: 0,
        call: { ids: ["luna-wallpaper"], options: { closeApps: false } },
      });
    for (const fail of ["query", "configure"])
      expect((await run(["luna-wallpaper"], fail)).code).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
