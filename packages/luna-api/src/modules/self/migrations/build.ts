import { readFile, readlink, realpath } from "node:fs/promises";
import { join, resolve } from "pathe";
import { environment } from "@/lib/env.ts";
import { InstallContext } from "@/modules/self/install/command.ts";
import { migrationRunner } from "./run.ts";
import { migrationState } from "./state.ts";

/** Migrations started by the CLI build script, so a fetched build migrates before it is published. */
class BuildMigrations {
  /**
   * Run pending migrations for a build started by `self update`; other builds return without
   * changes. Includes the first update from v0.0.2, whose updater predates migration tracking.
   */
  async run(repository: string) {
    const env = environment();
    if (env.LUNA_MIGRATION_RUNNING === "1" || env.LUNA_SELF_INSTALL === "1") return;
    const home = env.HOME;
    if (!home || !home.startsWith("/") || resolve(home) === "/") return;
    const canonicalHome = await realpath(home);
    const baseline = env.LUNA_UPDATE_FROM_VERSION;
    if (!baseline && !(await this.releasedUpdater({ home: canonicalHome, parent: process.ppid })))
      return;
    const context = new InstallContext(
      await realpath(repository),
      canonicalHome,
      { ...env, HOME: canonicalHome },
      (message) => console.error(message),
    );
    // v0.0.2 is the last release before migration tracking. Its updater fetches this
    // build script but cannot pass a baseline or call the new runner itself.
    const run = () => migrationRunner.run({ context, baseline: baseline ?? "0.0.2" });
    if (baseline) await run(); // The modern updater holds the self-operation lock.
    else await migrationState.selfLocked({ context, operation: run });
  }

  /** Recognize only the installed CLI's live update ancestor, never ordinary compile-only builds. */
  async releasedUpdater({
    home,
    parent,
    proc = "/proc",
  }: {
    home: string;
    parent: number;
    proc?: string;
  }) {
    let pid = parent;
    const seen = new Set<number>();
    const installed = join(home, ".local/bin/luna");
    while (pid > 1 && !seen.has(pid)) {
      seen.add(pid);
      try {
        const path = join(proc, String(pid));
        const executable = (await readlink(join(path, "exe"))).replace(/ \(deleted\)$/u, "");
        const args = (await readFile(join(path, "cmdline"), "utf8")).split("\0").filter(Boolean);
        if (
          executable === installed &&
          args.includes("self") &&
          args[args.indexOf("self") + 1] === "update"
        )
          return true;
        const stat = await readFile(join(path, "stat"), "utf8");
        // The parent PID follows the parenthesized command name, which may contain spaces.
        pid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      } catch (error) {
        if (["ENOENT", "ESRCH", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? ""))
          return false;
        throw error;
      }
    }
    return false;
  }
}

export const buildMigrations = new BuildMigrations();
