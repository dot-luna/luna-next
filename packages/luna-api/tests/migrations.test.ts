import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { Luna } from "../src/index.ts";
import { migrationPlan } from "../src/self/migrations/plan.ts";
import { InstallContext } from "../src/self/install/command.ts";
import { runMigrations } from "../src/self/migrations/run.ts";
import { readState, selfLocked } from "../src/self/migrations/state.ts";
import { releasedUpdater } from "../src/self/migrations/build.ts";
import { SelfFixture } from "./fixtures/self-fixture.ts";

const userTests = process.getuid?.() === 0 ? describe.skip : describe;
userTests("versioned migrations", () => {
  let f: SelfFixture;
  beforeEach(() => {
    f = new SelfFixture();
  });
  afterEach(() => {
    f.dispose();
  });
  const context = () => new InstallContext(f.repository, f.home, f.env, () => {});
  function script(from: string, to: string, body: string, extension = "sh") {
    const name = `migrations/v${from}-v${to}.${extension}`;
    f.write(f.upstream, name, `#!${Bun.which("bash")}\nset -eu\n${body}\n`);
    chmodSync(join(f.upstream, name), 0o755);
  }
  function version(value: string) {
    f.write(
      f.upstream,
      "package.json",
      JSON.stringify({ name: "Luna", version: value, description: "Fixture" }),
    );
    f.commit("Release " + value);
  }
  test("self update follows a numeric chain across skipped releases and never reruns completed scripts", async () => {
    script(
      "1.0.0",
      "1.0.2",
      'printf "%s>%s\\n" "$LUNA_MIGRATION_FROM_VERSION" "$LUNA_MIGRATION_TO_VERSION" >> "$HOME/migrated"',
    );
    script("1.0.2", "1.0.10", 'printf "second\\n" >> "$HOME/migrated"');
    version("1.0.10");
    expect(await Luna.self.update({ env: f.env })).toMatchObject({ succes: true });
    expect(readFileSync(join(f.home, "migrated"), "utf8")).toBe("1.0.0>1.0.2\nsecond\n");
    expect(await readState(context())).toMatchObject({ version: "1.0.10" });
    expect(await Luna.self.update({ env: f.env })).toMatchObject({ succes: true });
    expect(readFileSync(join(f.home, "migrated"), "utf8")).toBe("1.0.0>1.0.2\nsecond\n");
  });
  test("failed scripts preserve the CLI and resume after the last successful step even after checkout moves", async () => {
    script("1.0.0", "1.0.1", 'printf "first\\n" >> "$HOME/migrated"');
    script(
      "1.0.1",
      "1.0.2",
      '[ -f "$HOME/allow" ] || exit 9\nprintf "second\\n" >> "$HOME/migrated"',
    );
    version("1.0.2");
    const failure = await Luna.self.update({ env: f.env });
    expect(failure.succes).toBe(false);
    if (failure.succes) throw new Error("Expected migration failure");
    expect(failure.errMessage).toContain("Retry:");
    expect(failure.errMessage).toStartWith("Luna update incomplete.");
    expect(failure.errMessage).toContain("Completed migration steps are saved");
    expect(await readState(context())).toMatchObject({ version: "1.0.1" });
    expect(readFileSync(f.executable, "utf8")).toBe("previous CLI");
    f.write(f.home, "allow", "");
    expect(await Luna.self.update({ env: f.env })).toMatchObject({ succes: true });
    expect(readFileSync(join(f.home, "migrated"), "utf8")).toBe("first\nsecond\n");
  });
  test("a build failure keeps the original baseline for the next update", async () => {
    script("1.0.0", "1.0.1", 'printf done > "$HOME/migrated"');
    version("1.0.1");
    const failure = await Luna.self.update({
      env: { ...f.env, SELF_FAIL: "bun:run" },
      ref: "master",
    });
    expect(failure).toMatchObject({
      succes: false,
    });
    if (failure.succes) throw new Error("Expected build failure");
    const command = failure.errMessage.split("\n")[1]!;
    const parsed = Bun.spawnSync([
      Bun.which("bash")!,
      "-c",
      `set -- ${command}; printf '%s\\n' "$@"`,
    ]);
    expect(parsed.exitCode).toBe(0);
    expect(parsed.stdout.toString().trim().split("\n")).toEqual([
      f.executable,
      "self",
      "update",
      "--install-dir",
      f.repository,
      "--ref",
      "master",
    ]);
    expect(await readState(context())).toMatchObject({ version: "1.0.0" });
    expect(await Luna.self.update({ env: f.env })).toMatchObject({ succes: true });
    expect(readFileSync(join(f.home, "migrated"), "utf8")).toBe("done");
  });
  test("a missing link rejects the entire plan before its first script or CLI publication", async () => {
    script("1.0.0", "1.0.1", 'printf done > "$HOME/migrated"');
    version("1.0.2");
    expect(await Luna.self.update({ env: f.env })).toMatchObject({
      succes: false,
      errMessage: expect.stringContaining("Missing migration"),
    });
    expect(existsSync(join(f.home, "migrated"))).toBe(false);
    expect(readFileSync(f.executable, "utf8")).toBe("previous CLI");
  });
  test("ambiguous edges, nonexecutable files, symlinks and backwards upgrades are rejected", async () => {
    script("1.0.0", "1.0.1", ":");
    script("1.0.0", "1.0.2", ":");
    const plan = () => migrationPlan({ repository: f.upstream, from: "1.0.0", to: "1.0.2" });
    await expect(plan()).rejects.toThrow("one forward successor");
    await expect(
      migrationPlan({ repository: f.upstream, from: "1.0.2", to: "1.0.0" }),
    ).rejects.toThrow("backwards");
    const path = join(f.repository, "migrations/v1.0.0-v1.0.1.sh");
    f.write(f.repository, "migrations/v1.0.0-v1.0.1.sh", "#!/bin/bash\n:");
    const own = () => migrationPlan({ repository: f.repository, from: "1.0.0", to: "1.0.1" });
    await expect(own()).rejects.toThrow("executable");
    const { rmSync } = await import("node:fs");
    rmSync(path);
    symlinkSync(join(f.upstream, "migrations/v1.0.0-v1.0.1.sh"), path);
    await expect(own()).rejects.toThrow("executable");
  });
  test("fresh installation records its version without replaying historical migrations", async () => {
    f.write(f.repository, "migrations/v0.0.1-v1.0.0.sh", "#!/bin/bash\nexit 99\n");
    chmodSync(join(f.repository, "migrations/v0.0.1-v1.0.0.sh"), 0o755);
    expect(
      await Luna.self.install({
        env: f.env,
        fromBootstrap: true,
        git: { name: "User", email: "user@example.test" },
      }),
    ).toMatchObject({ succes: true });
    expect(await readState(context())).toMatchObject({ version: "1.0.0" });
  });
  test("concurrent self updates cannot move the checkout", async () => {
    await selfLocked(context(), async () => {
      expect(await Luna.self.update({ env: f.env })).toMatchObject({
        succes: false,
        err: "CONFLICT",
      });
    });
    expect(f.commands().some((command) => command.args.includes("fetch"))).toBe(false);
  });
  test("TypeScript shebang scripts run with the current checkout and environment", async () => {
    f.write(f.repository, "package.json", '{"version":"1.0.1"}');
    f.write(
      f.repository,
      "migrations/v1.0.0-v1.0.1.ts",
      `#!${process.execPath}\nawait Bun.write(process.env.HOME + '/typed', process.env.LUNA_ROOT + ':' + process.env.LUNA_MIGRATION_TO_VERSION);\n`,
    );
    chmodSync(join(f.repository, "migrations/v1.0.0-v1.0.1.ts"), 0o755);
    await runMigrations(context(), "1.0.0");
    expect(readFileSync(join(f.home, "typed"), "utf8")).toBe(f.repository + ":1.0.1");
  });
  test("the first-release build handoff only recognizes an installed self-update ancestor", async () => {
    const proc = join(f.root, "proc");
    f.write(proc, "123/cmdline", `${f.executable}\0self\0update\0`);
    symlinkSync(f.executable, join(proc, "123/exe"));
    expect(await releasedUpdater({ home: f.home, parent: 123, proc })).toBe(true);
    f.write(proc, "123/cmdline", `${f.executable}\0self\0install\0`);
    f.write(proc, "123/stat", "123 (luna) S 1 0");
    expect(await releasedUpdater({ home: f.home, parent: 123, proc })).toBe(false);
  });
});
