import { readFile, readlink, realpath } from "node:fs/promises";
import { join, resolve } from "pathe";
import { InstallContext } from "@/modules/self/install/command.ts";
import { runMigrations } from "./run.ts";
import { selfLocked } from "./state.ts";

/** Recognize only the installed CLI's live update ancestor, never ordinary compile-only builds. */
export async function releasedUpdater(options: { home: string; parent: number; proc?: string }) {
  const root = options.proc ?? "/proc";
  let pid = options.parent;
  const seen = new Set<number>();
  const installed = join(options.home, ".local/bin/luna");
  while (pid > 1 && !seen.has(pid)) {
    seen.add(pid);
    try {
      const path = join(root, String(pid));
      const executable = (await readlink(join(path, "exe"))).replace(/ \(deleted\)$/u, "");
      const args = (await readFile(join(path, "cmdline"), "utf8")).split("\0").filter(Boolean);
      if (
        executable === installed &&
        args.includes("self") &&
        args[args.indexOf("self") + 1] === "update"
      )
        return true;
      const stat = await readFile(join(path, "stat"), "utf8");
      pid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
    } catch (error) {
      if (["ENOENT", "ESRCH", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? ""))
        return false;
      throw error;
    }
  }
  return false;
}

/** The fetched build code runs before publication, including the first update from v0.0.2. */
export async function migrateAfterBuild(repository: string) {
  const env = Object.fromEntries(
    Object.entries(Bun.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  if (env.LUNA_MIGRATION_RUNNING === "1" || env.LUNA_SELF_INSTALL === "1") return;
  const home = env.HOME;
  if (!home || !home.startsWith("/") || resolve(home) === "/") return;
  const canonicalHome = await realpath(home);
  const baseline = env.LUNA_UPDATE_FROM_VERSION;
  if (!baseline && !(await releasedUpdater({ home: canonicalHome, parent: process.ppid }))) return;
  const context = new InstallContext(
    await realpath(repository),
    canonicalHome,
    { ...env, HOME: canonicalHome },
    (message) => console.error(message),
  );
  // v0.0.2 is the last release before migration tracking. Its updater fetches this
  // build script but cannot pass a baseline or call the new runner itself.
  const run = () => runMigrations(context, baseline ?? "0.0.2");
  if (baseline) await run(); // The modern updater holds the self-operation lock.
  else await selfLocked(context, run);
}
