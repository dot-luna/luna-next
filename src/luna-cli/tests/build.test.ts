import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("build publishes target/luna over the installed CLI; compile-only keeps the installed binary", async () => {
  const home = mkdtempSync(join(tmpdir(), "luna build "));
  try {
    const directory = join(home, ".local/bin");
    mkdirSync(directory, { recursive: true });
    const installed = join(directory, "luna");
    writeFileSync(installed, "previous CLI");
    const run = async (args: string[]) => {
      const child = Bun.spawn(
        [process.execPath, resolve(import.meta.dir, "../src/build.ts"), ...args],
        { env: { ...Bun.env, HOME: home }, stdout: "pipe", stderr: "pipe" },
      );
      const [stdout, stderr, status] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(status, stdout + stderr).toBe(0);
    };
    await run(["--no-install"]);
    expect(readFileSync(installed, "utf8")).toBe("previous CLI");
    await run([]);
    expect(statSync(installed).mode & 0o777).toBe(0o755);
    expect(
      readFileSync(installed).equals(
        readFileSync(resolve(import.meta.dir, "../../../target/luna")),
      ),
    ).toBe(true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 15000);
