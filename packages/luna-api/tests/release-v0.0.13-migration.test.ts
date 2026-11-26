import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrationPlanner } from "../src/modules/self/migrations/plan.ts";

test("v0.0.13 upgrades Hyprland or Polkit installations, respects disabled apps and retries service cleanup", async () => {
  const root = await mkdtemp(join(tmpdir(), "luna-v0.0.13-"));
  try {
    const repository = new URL("../../../", import.meta.url).pathname;
    const [step] = await migrationPlanner.plan({ repository, from: "0.0.12", to: "0.0.13" });
    const script = join(root, "migrations/v0.0.12-v0.0.13.ts");
    let source = await Bun.file(step!.path).text();
    // Keep filesystem safety helpers real; only package operations and systemctl are fixtures.
    for (const name of ["files", "paths"])
      source = source.replace(
        `../packages/luna-api/src/lib/${name}.ts`,
        `${repository}packages/luna-api/src/lib/${name}.ts`,
      );
    await Bun.write(script, source);
    await Bun.write(
      join(root, "packages/luna-api/src/index.ts"),
      `
      import {appendFileSync} from 'node:fs';
      function call(name, ids, options) {
        appendFileSync(Bun.env.FIXTURE_LOG, JSON.stringify({name,ids,options})+'\\n');
        return {succes:Bun.env.FIXTURE_FAIL!==name, data:{installed:Bun.env.FIXTURE_DISABLED==='1'?[]:ids},errMessage:name+' failed'};
      }
      export const Luna={apps:{
        installed:async()=>({succes:Bun.env.FIXTURE_FAIL!=='query',data:JSON.parse(Bun.env.FIXTURE_INSTALLED),errMessage:'query failed'}),
        install:async(ids,options)=>call('install',ids,options),
        configure:async(ids,options)=>call('configure',ids,options)
      }};
    `,
    );
    const log = join(root, "calls");
    const systemctl = join(root, "bin/systemctl");
    await Bun.write(
      systemctl,
      `#!${process.execPath}\nimport {appendFileSync} from 'node:fs';\nappendFileSync(Bun.env.FIXTURE_LOG,JSON.stringify({name:'systemctl',args:Bun.argv.slice(2)})+'\\n');\nprocess.exit(Bun.env.FIXTURE_FAIL==='systemctl'?1:0);\n`,
    );
    await chmod(systemctl, 0o755);
    const unit = join(root, ".config/systemd/user/luna-next-polkit.service");
    async function run(installed: string[], failure = "", disabled = false) {
      await Bun.write(log, "");
      const child = Bun.spawnSync([process.execPath, script], {
        env: {
          HOME: root,
          PATH: join(root, "bin") + ":/usr/bin",
          FIXTURE_LOG: log,
          FIXTURE_INSTALLED: JSON.stringify(installed),
          FIXTURE_FAIL: failure,
          FIXTURE_DISABLED: disabled ? "1" : "0",
        },
      });
      const calls = (await Bun.file(log).text()).trim();
      return {
        code: child.exitCode,
        calls: calls ? calls.split("\n").map((line) => JSON.parse(line)) : [],
      };
    }
    expect(await run([])).toEqual({ code: 0, calls: [] });
    expect(await run(["hypr"], "query")).toEqual({ code: 1, calls: [] });
    expect((await run(["hypr"], "install")).code).toBe(1);
    expect((await run(["hypr"], "configure")).code).toBe(1);
    const installed = { name: "install", ids: ["luna-polkit"], options: { closeApps: false } };
    expect(await run(["hypr"], "", true)).toEqual({ code: 0, calls: [installed] });
    expect(await run(["luna-polkit"])).toEqual({ code: 0, calls: [installed] });
    await Bun.write(unit, "obsolete service");
    expect((await run(["hypr"], "systemctl")).code).toBe(1);
    expect(await Bun.file(unit).exists()).toBe(true);
    const migrated = await run(["hypr"]);
    expect(migrated.code).toBe(0);
    expect(migrated.calls).toEqual([
      installed,
      { name: "systemctl", args: ["--user", "disable", "--now", "luna-next-polkit.service"] },
      { name: "systemctl", args: ["--user", "daemon-reload"] },
      { name: "configure", ids: ["hypr"], options: { closeApps: false } },
    ]);
    expect(await Bun.file(unit).exists()).toBe(false);
    expect(await run(["hypr"])).toEqual({
      code: 0,
      calls: [installed, { name: "configure", ids: ["hypr"], options: { closeApps: false } }],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
