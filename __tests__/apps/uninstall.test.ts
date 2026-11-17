import { afterEach, beforeEach, expect, test } from "bun:test";
import { cpSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { AppFixture } from "../../packages/luna-api/tests/fixtures/app-fixture.ts";
import { appCatalog } from "../../packages/luna-api/src/modules/apps/catalog.ts";
import { appCleanup } from "../../packages/luna-api/src/modules/apps/cleanup.ts";
import { appContext } from "../../packages/luna-api/src/modules/apps/context.ts";

const repository = resolve(import.meta.dir, "../..");
let f: AppFixture;
beforeEach(() => {
  f = new AppFixture();
});
afterEach(() => f.dispose());

test("catalog cleanup resolves only app-owned paths under an isolated home", async () => {
  const context = await appContext.resolve({ repository, env: f.env });
  const catalog = await appCatalog.read(context);
  for (const app of catalog) {
    for (const purge of [false, true]) {
      const paths = await appCleanup.plan({ context, app, catalog, purge });
      expect(paths.length).toBeGreaterThan(0);
      expect(paths.every((path) => path.startsWith(f.home + "/"))).toBe(true);
    }
  }
});

test.each(["menu", "notify", "wallpaper", "lock", "screensaver"])(
  "%s stop hook respects no-close and repeated uninstall",
  async (name) => {
    const configHome = join(f.home, ".config/luna");
    const apiEntry = join(repository, "packages/luna-api/src/index.ts");
    const hook = join(repository, `apps/luna-${name}/scripts/stop.ts`);
    // Stub the stop API before importing the real hook; no desktop process can be contacted.
    const script = `
import { Luna } from ${JSON.stringify(apiEntry)};
Luna[${JSON.stringify(name)}].stop = async () => {
  console.log("stopped");
  return { succes: true, data: {} };
};
await import(${JSON.stringify(hook)});
`;
    const run = (closeApps: boolean) =>
      Bun.spawnSync([process.execPath, "--eval", script], {
        env: { ...f.env, LUNA_CONFIG_HOME_DIR: configHome, LUNA_CLOSE_APPS: closeApps ? "1" : "0" },
        stdout: "pipe",
        stderr: "pipe",
      });
    f.write(configHome, `${name}/shell.qml`, "fixture");
    const disabled = run(false);
    expect(disabled.exitCode).toBe(0);
    expect(disabled.stdout.toString()).toBe("");
    const enabled = run(true);
    expect(enabled.exitCode).toBe(0);
    expect(enabled.stdout.toString()).toBe("stopped\n");
    rmSync(join(configHome, name), { recursive: true });
    const repeated = run(true);
    expect(repeated.exitCode).toBe(0);
    expect(repeated.stdout.toString()).toBe("");
  },
);

test("Yay's custom uninstall removes its package once and leaves other packages", () => {
  const script = join(f.root, "uninstall.sh");
  cpSync(join(repository, "apps/yay/scripts/uninstall.sh"), script);
  f.write(f.root, "installed.json", JSON.stringify(["yay", "unrelated"]));
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = Bun.spawnSync([join(f.bin, "bash"), script], {
      env: f.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
  }
  expect(JSON.parse(readFileSync(f.env.SELF_INSTALLED_JSON!, "utf8"))).toEqual(["unrelated"]);
  expect(
    f
      .commands()
      .filter((call) => call.name === "pacman" && call.args[0] === "-R")
      .map((call) => call.args),
  ).toEqual([["-R", "--noconfirm", "--", "yay"]]);
});
