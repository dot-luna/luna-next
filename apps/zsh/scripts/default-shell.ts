#!/usr/bin/env bun
import { realpath } from "node:fs/promises";

type Runner = (args: string[]) => string;
const execute: Runner = (args) => {
  const child = Bun.spawnSync(args, { stdin: "inherit", stdout: "pipe", stderr: "pipe" });
  if (child.exitCode !== 0)
    throw new Error(
      `${args[0]} failed (${child.exitCode}): ${(child.stderr.toString() || child.stdout.toString()).trim()}`,
    );
  return child.stdout.toString().trim();
};

/** Account records determine the login shell; SHELL can still describe an older session. */
export async function setDefaultShell(
  options: { run?: Runner; uid?: number; zsh?: string; shellsFile?: string } = {},
) {
  const run = options.run ?? execute,
    uid = options.uid ?? process.getuid?.();
  if (uid === undefined || uid === 0)
    throw new Error("Set the default shell as a normal Linux user");
  const selected = options.zsh ?? Bun.which("zsh");
  if (!selected) throw new Error("Install Zsh before selecting the login shell");
  const zsh = await realpath(selected);
  const fields = run(["getent", "passwd", String(uid)]).split(":");
  const user = fields[0];
  if (
    fields.length !== 7 ||
    Number(fields[2]) !== uid ||
    !user ||
    user.startsWith("-") ||
    user.includes("\n")
  )
    throw new Error("Cannot resolve the current login account");
  let current: string | undefined;
  try {
    current = await realpath(fields[6]!);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (current === zsh) return false;
  const registered = (await Bun.file(options.shellsFile ?? "/etc/shells").text())
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("/"));
  const allowed = await Promise.all(
    registered.map(async (path) => {
      try {
        return await realpath(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
        throw error;
      }
    }),
  );
  if (!allowed.includes(zsh))
    throw new Error("Zsh must be listed in /etc/shells before selecting it");
  run(["sudo", "chsh", "--shell", zsh, "--", user]);
  return true;
}
if (import.meta.main)
  setDefaultShell()
    .then((changed) =>
      console.log(
        changed
          ? "Default shell set to Zsh; log in again to use it."
          : "Default shell is already Zsh.",
      ),
    )
    .catch((error) => {
      console.error(`Configure Zsh login shell: ${String(error)}`);
      process.exitCode = 1;
    });
