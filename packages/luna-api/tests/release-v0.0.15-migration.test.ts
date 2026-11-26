import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrationPlanner } from "../src/modules/self/migrations/plan.ts";

test("v0.0.15 refreshes only an installed Lock through guarded app hooks and propagates failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "luna-v0.0.15-"));
  try {
    const repository = new URL("../../../", import.meta.url).pathname;
    const [step] = await migrationPlanner.plan({ repository, from: "0.0.14", to: "0.0.15" });
    const script = join(root, "migrations/v0.0.14-v0.0.15.ts");
    await Bun.write(script, await Bun.file(step!.path).text());
    await Bun.write(
      join(root, "packages/luna-api/src/index.ts"),
      `
      export const Luna={apps:{
        installed:async(ids)=>{if(JSON.stringify(ids)!=='["luna-lock"]')throw new Error('Unrelated app query');return {succes:Bun.env.FAIL!=='query',data:JSON.parse(Bun.env.INSTALLED),errMessage:'query failed'};},
        install:async(ids,options)=>{await Bun.write(Bun.env.LOG,JSON.stringify({ids,options}));return {succes:!['install','locked','locking'].includes(Bun.env.FAIL),data:{installed:Bun.env.DISABLED==='1'?[]:ids},errMessage:'Unlock the session before configuring Luna Lock'};}
      }};
    `,
    );
    const log = join(root, "calls");
    async function run({
      installed = [],
      fail = "",
      disabled = false,
    }: { installed?: string[]; fail?: string; disabled?: boolean } = {}) {
      await Bun.write(log, "");
      const child = Bun.spawn([process.execPath, script], {
        env: {
          INSTALLED: JSON.stringify(installed),
          FAIL: fail,
          DISABLED: disabled ? "1" : "0",
          LOG: log,
        },
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
    expect(await run()).toMatchObject({ code: 0, call: null });
    const call = { ids: ["luna-lock"], options: { closeApps: false } };
    expect(await run({ installed: ["luna-lock"] })).toMatchObject({ code: 0, call });
    expect(await run({ installed: ["luna-lock"] })).toMatchObject({ code: 0, call });
    expect(await run({ installed: ["luna-lock"], disabled: true })).toMatchObject({
      code: 0,
      call,
    });
    for (const fail of ["query", "install", "locked", "locking"])
      expect((await run({ installed: ["luna-lock"], fail })).code).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
