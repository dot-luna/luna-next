import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrationPlan } from "../src/self/migrations/plan.ts";

test("v0.0.5 preserves the pending browser migration before its no-op step", async () => {
  const plan = await migrationPlan({
    repository: new URL("../../../", import.meta.url).pathname,
    from: "0.0.3",
    to: "0.0.5",
  });
  expect(plan.map(({ from, to }) => [from, to])).toEqual([
    ["0.0.3", "0.0.4"],
    ["0.0.4", "0.0.5"],
  ]);
  expect(Bun.spawnSync([plan[1]!.path]).exitCode).toBe(0);
});

test("v0.0.4 migration stops on failure and retries Notify before Chromium", async () => {
  const root = await mkdtemp(join(tmpdir(), "luna-browser-migration-"));
  try {
    const script = join(root, "migrations/v0.0.3-v0.0.4.ts");
    await Bun.write(
      script,
      Bun.file(new URL("../../../migrations/v0.0.3-v0.0.4.ts", import.meta.url)),
    );
    await chmod(script, 0o755);
    await Bun.write(
      join(root, "packages/luna-api/src/index.ts"),
      `
      import {appendFile} from "node:fs/promises";
      export const Luna = {apps: {configure: async ([name]) => {
        await appendFile(Bun.env.FIXTURE_LOG, name + "\\n");
        return name === Bun.env.FIXTURE_FAIL ? {succes:false, errMessage:"fixture failure"} : {succes:true};
      }}};
    `,
    );
    const log = join(root, "calls");
    function run(failure: string) {
      return Bun.spawnSync([script], {
        env: {
          ...Bun.env,
          PATH: `${process.execPath.slice(0, process.execPath.lastIndexOf("/"))}:${Bun.env.PATH}`,
          FIXTURE_LOG: log,
          FIXTURE_FAIL: failure,
        },
        stderr: "pipe",
        stdout: "pipe",
      });
    }
    expect(run("luna-notify").exitCode).toBe(1);
    expect(await Bun.file(log).text()).toBe("luna-notify\n");
    expect(run("chromium").exitCode).toBe(1);
    expect(run("").exitCode).toBe(0);
    expect(await Bun.file(log).text()).toBe(
      "luna-notify\nluna-notify\nchromium\nluna-notify\nchromium\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
