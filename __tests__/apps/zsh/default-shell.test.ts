import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setDefaultShell } from "../../../apps/zsh/scripts/default-shell.ts";

test("Zsh uses the account shell, changes it only when needed and validates registration", async () => {
  const root = mkdtempSync(join(tmpdir(), "luna-shell "));
  try {
    const zsh = join(root, "zsh"),
      old = join(root, "bash"),
      shells = join(root, "shells");
    writeFileSync(zsh, "");
    writeFileSync(old, "");
    writeFileSync(shells, zsh + "\n");
    const calls: string[][] = [];
    let current = old;
    const run = (args: string[]) => {
      calls.push(args);
      return args[0] === "getent" ? `fixture:x:123:123::${root}:${current}` : "";
    };
    expect(await setDefaultShell({ run, uid: 123, zsh, shellsFile: shells })).toBe(true);
    expect(calls.at(-1)).toEqual(["sudo", "chsh", "--shell", zsh, "--", "fixture"]);
    calls.length = 0;
    current = zsh;
    expect(await setDefaultShell({ run, uid: 123, zsh, shellsFile: shells })).toBe(false);
    expect(calls).toHaveLength(1);
    current = old;
    writeFileSync(shells, old + "\n");
    await expect(setDefaultShell({ run, uid: 123, zsh, shellsFile: shells })).rejects.toThrow(
      "/etc/shells",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
