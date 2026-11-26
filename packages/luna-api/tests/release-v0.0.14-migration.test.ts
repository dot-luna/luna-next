import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrationPlanner } from "../src/modules/self/migrations/plan.ts";

test("v0.0.14 installs Login for existing Luna desktops and native Login themes, and propagates failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "luna-v0.0.14-"));
  try {
    const repository = new URL("../../../", import.meta.url).pathname;
    const [step] = await migrationPlanner.plan({ repository, from: "0.0.13", to: "0.0.14" });
    const script = join(root, "migrations/v0.0.13-v0.0.14.ts");
    await Bun.write(script, await Bun.file(step!.path).text());
    await Bun.write(
      join(root, "packages/luna-api/src/index.ts"),
      `
      export const Luna={
        apps:{
          installed:async()=>({succes:Bun.env.FAIL!=='query',data:JSON.parse(Bun.env.INSTALLED),errMessage:'query failed'}),
          install:async(ids,options)=>{await Bun.write(Bun.env.LOG,JSON.stringify({ids,options}));return {succes:Bun.env.FAIL!=='install',data:{installed:Bun.env.DISABLED==='1'?[]:ids},errMessage:'install failed'};}
        },
        login:{status:async()=>({succes:Bun.env.FAIL!=='status',data:{installed:Bun.env.NATIVE==='1'},errMessage:'status failed'})}
      };
    `,
    );
    const log = join(root, "calls");
    async function run({
      installed = [],
      native = false,
      fail = "",
      disabled = false,
    }: { installed?: string[]; native?: boolean; fail?: string; disabled?: boolean } = {}) {
      await Bun.write(log, "");
      const child = Bun.spawn([process.execPath, script], {
        env: {
          INSTALLED: JSON.stringify(installed),
          NATIVE: native ? "1" : "0",
          FAIL: fail,
          DISABLED: disabled ? "1" : "0",
          LOG: log,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const code = await child.exited;
      const source = await Bun.file(log).text();
      return { code, call: source ? JSON.parse(source) : null };
    }
    expect(await run()).toEqual({ code: 0, call: null });
    const call = { ids: ["luna-login"], options: { closeApps: false } };
    for (const installed of [["hypr"], ["luna-login"]]) {
      expect(await run({ installed })).toEqual({ code: 0, call });
      expect(await run({ installed })).toEqual({ code: 0, call });
    }
    expect(await run({ native: true })).toEqual({ code: 0, call });
    expect(await run({ installed: ["hypr"], disabled: true })).toEqual({ code: 0, call });
    for (const fail of ["query", "status", "install"])
      expect((await run({ installed: ["hypr"], fail })).code).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
