import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SelfFixture } from "../../../packages/luna-api/tests/fixtures/self-fixture.ts";

const entry = resolve(import.meta.dir, "../src/index.ts");

async function cli(value: SelfFixture, args: string[], executable?: string) {
  const child = Bun.spawn(executable ? [executable, ...args] : [process.execPath, entry, ...args], {
    env: value.env,
    cwd: value.root,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

const userTests = process.getuid?.() === 0 ? describe.skip : describe;
userTests("CLI self commands", () => {
  let value: SelfFixture;
  beforeEach(() => {
    value = new SelfFixture();
  });
  afterEach(() => {
    value.dispose();
  });

  test("install accepts bootstrap handoff, relative paths and identity flags without JSON output contamination", async () => {
    value.env.LUNA_ROOT = join(value.root, "wrong checkout");
    const result = await cli(value, [
      "self",
      "install",
      "--from-bootstrap",
      "--install-dir",
      "./checkout",
      "--ref=latest",
      "--git-name",
      "CLI User",
      "--git-email=cli@example.test",
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(result.stdout)).toEqual({
      succes: true,
      data: {
        repository: value.repository,
        executable: value.executable,
        cliRebuilt: false,
        pending: ["themes", "apps", "later", "webapps"],
      },
    });
    expect(value.git(value.repository, ["config", "--global", "user.name"])).toBe("CLI User");
    expect(value.commands().some((item) => item.args.includes("pull") || item.name === "bun")).toBe(
      false,
    );
  });

  test("JSON installation reports missing identity and does not prompt", async () => {
    const result = await cli(value, ["--json", "self", "install", "--from-bootstrap"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({ succes: false, err: "INPUT_REQUIRED" });
    expect(value.commands().some((item) => item.args.includes("gcc"))).toBe(false);
  });

  test("human output reports partial setup and writes progress to stderr", async () => {
    const result = await cli(value, [
      "self",
      "install",
      "--from-bootstrap",
      "--git-name",
      "Human User",
      "--git-email",
      "human@example.test",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Pending: themes, apps, later, webapps");
    expect(result.stdout).not.toContain("routine command output");
    expect(result.stderr).toContain("Configuring Git");
  });

  test.each([false, true])(
    "requests Git identity through a terminal (piped stdin: %s)",
    async (piped) => {
      let captured = "";
      let sentName = false;
      let sentEmail = false;
      const args = [process.execPath, entry, "self", "install", "--from-bootstrap"];
      // A shell redirect reproduces curl | bash: stdin is unavailable, but /dev/tty exists.
      const command = piped
        ? [Bun.which("bash")!, "-c", 'exec "$@" </dev/null', "fixture", ...args]
        : args;
      const child = Bun.spawn(command, {
        env: value.env,
        cwd: value.root,
        terminal: {
          data(terminal, data) {
            captured += new TextDecoder().decode(data);
            if (!sentName && captured.includes("Git user name:")) {
              sentName = true;
              terminal.write("Terminal User\n");
            }
            if (!sentEmail && captured.includes("Git email:")) {
              sentEmail = true;
              terminal.write("terminal@example.test\n");
            }
          },
        },
      });
      const timer = setTimeout(() => child.kill(), 5000);
      try {
        expect(await child.exited, captured).toBe(0);
        expect(sentName && sentEmail).toBe(true);
        expect(value.git(value.repository, ["config", "--global", "user.name"])).toBe(
          "Terminal User",
        );
        expect(value.git(value.repository, ["config", "--global", "user.email"])).toBe(
          "terminal@example.test",
        );
      } finally {
        clearTimeout(timer);
        child.kill();
        child.terminal?.close();
      }
    },
    10000,
  );

  test("update forwards branch selection and builds without desktop package operations", async () => {
    value.git(value.upstream, ["switch", "-c", "feature/ref"]);
    value.write(value.upstream, "selected.txt", "branch content");
    value.commit("Selected ref");
    const result = await cli(value, [
      "self",
      "update",
      "--ref",
      "feature/ref",
      "--install-dir=" + value.repository,
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      succes: true,
      data: { repository: value.repository, executable: value.executable },
    });
    expect(value.git(value.repository, ["branch", "--show-current"])).toBe("feature/ref");
    expect(readFileSync(join(value.repository, "selected.txt"), "utf8")).toBe("branch content");
    expect(value.commands().some((item) => ["pacman", "sudo"].includes(item.name))).toBe(false);
  });

  test("removed pull-only flag and missing ref values are argument errors before any operation", async () => {
    for (const args of [
      ["self", "install", "--no-git-pull"],
      ["self", "update", "--ref"],
      ["self", "install", "--install-dir"],
    ]) {
      const result = await cli(value, [...args, "--json"]);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({ succes: false, err: "INVALID_ARGUMENT" });
    }
    expect(value.commands()).toEqual([]);
  });

  test("compiled CLI supports self install and self update", async () => {
    const executable = join(value.root, "compiled-luna");
    const build = Bun.spawnSync(
      [process.execPath, "build", "--compile", entry, "--outfile", executable],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(build.exitCode, build.stderr.toString()).toBe(0);
    const install = await cli(
      value,
      [
        "self",
        "install",
        "--from-bootstrap",
        "--git-name",
        "Compiled User",
        "--git-email",
        "compiled@example.test",
        "--json",
      ],
      executable,
    );
    expect(install.exitCode, install.stdout + install.stderr).toBe(0);
    expect(JSON.parse(install.stdout)).toMatchObject({ succes: true, data: { cliRebuilt: false } });
    const update = await cli(value, ["self", "update", "--ref=master", "--json"], executable);
    expect(update.exitCode, update.stdout + update.stderr).toBe(0);
    expect(JSON.parse(update.stdout)).toMatchObject({
      succes: true,
      data: { executable: value.executable },
    });
  }, 15000);
});
