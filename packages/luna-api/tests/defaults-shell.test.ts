import { afterEach, beforeEach, expect, test } from "bun:test";
import { realpathSync, symlinkSync } from "node:fs";
import { join } from "pathe";
import { currentShell, prepareShell } from "../src/defaults/shell.ts";
import type { InstallContext } from "../src/self/install/command.ts";
import { DefaultsNativeFixture } from "./fixtures/defaults-native-fixture.ts";

let f: DefaultsNativeFixture;
beforeEach(() => {
  f = new DefaultsNativeFixture();
});
afterEach(() => f.dispose());

test("shell selection resolves links, reads the account shell, and only changes a different registered shell", async () => {
  f.command("selected-shell");
  f.command("old-shell");
  const shell = join(f.bin, "selected-shell");
  const alias = join(f.bin, "shell-alias");
  symlinkSync(shell, alias);
  const shells = join(f.root, "shells");
  f.write(shells, alias + "\n");
  let current = join(f.bin, "old-shell");
  const calls: string[][] = [];
  const context: Pick<InstallContext, "env" | "execute"> = {
    env: f.env,
    execute: async (args) => {
      calls.push(args);
      return {
        exitCode: 0,
        stderr: "",
        stdout: args[0] === "getent" ? `fixture:x:123:123::${f.home}:${current}\n` : "",
      };
    },
  };
  const selected = await prepareShell(context, "shell-alias", { uid: 123, shellsFile: shells });
  expect(selected.selected).toBe(realpathSync(shell));
  expect(calls).toEqual([["getent", "passwd", "123"]]);
  await selected.apply();
  expect(calls.at(-1)).toEqual(["sudo", "chsh", "--shell", shell, "--", "fixture"]);
  calls.length = 0;
  current = alias;
  await (await prepareShell(context, "selected-shell", { uid: 123, shellsFile: shells })).apply();
  expect(calls).toEqual([["getent", "passwd", "123"]]);
  expect((await currentShell(context, 123)).shell).toBe(shell);
  f.write(shells, current + "-not-registered\n");
  current = join(f.bin, "old-shell");
  await expect(
    prepareShell(context, "selected-shell", { uid: 123, shellsFile: shells }),
  ).rejects.toThrow("/etc/shells");
  expect(calls.filter((args) => args[0] === "sudo")).toHaveLength(0);
});

test("malformed accounts and root selection never run chsh", async () => {
  f.command("selected-shell");
  const calls: string[][] = [];
  let stdout = "-unsafe:x:123:123::/home/fixture:/bin/sh";
  const context: Pick<InstallContext, "env" | "execute"> = {
    env: f.env,
    execute: async (args) => {
      calls.push(args);
      return { exitCode: 0, stderr: "", stdout };
    },
  };
  await expect(prepareShell(context, "selected-shell", { uid: 123 })).rejects.toThrow("account");
  stdout = "root:x:0:0::/root:/bin/sh";
  await expect(prepareShell(context, "selected-shell", { uid: 0 })).rejects.toThrow(
    "normal Linux user",
  );
  expect(calls.every((args) => args[0] === "getent")).toBe(true);
});
