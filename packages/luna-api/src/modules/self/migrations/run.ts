import { dirname, join } from "pathe";
import { locked, metadata } from "@/lib/files.ts";
import { ordinaryParents } from "@/lib/paths.ts";
import { ApiError } from "@/lib/response.ts";
import { quote } from "@/modules/self/install/report.ts";
import type { InstallContext } from "@/modules/self/install/command.ts";
import { migrationPlan } from "./plan.ts";
import { checkoutVersion, readState, saveVersion, stateFile } from "./state.ts";

/** Run trusted release scripts as the caller. Scripts must tolerate partial execution on retry. */
export async function runMigrations(context: InstallContext, baseline: string) {
  const path = stateFile(context);
  await ordinaryParents(path);
  const lock = await metadata(path + ".lock");
  if (lock && !lock.isFile()) throw new ApiError("INVALID_PATH", "Invalid migration lock");
  await locked({ configFile: path, env: context.env }, async () => {
    const current = (await readState(context))?.version ?? baseline;
    const target = await checkoutVersion(context.repository);
    const plan = await migrationPlan({ repository: context.repository, from: current, to: target });
    await saveVersion(context, current);
    const env = { ...context.env };
    // A migration may rebuild the CLI. That nested build must not start migrations again.
    delete env.LUNA_UPDATE_FROM_VERSION;
    env.LUNA_MIGRATION_RUNNING = "1";
    env.PATH = `${join(context.repository, "target")}:${dirname(process.execPath)}:${env.PATH ?? ""}`;
    env.LUNA_ROOT = context.repository;
    const { InstallContext } = await import("@/modules/self/install/command.ts");
    const child = new InstallContext(
      context.repository,
      context.home,
      env,
      context.onProgress,
      context.log,
    );
    for (const step of plan) {
      context.progress(`Migrating Luna v${step.from} → v${step.to}...`);
      child.env.LUNA_MIGRATION_FROM_VERSION = step.from;
      child.env.LUNA_MIGRATION_TO_VERSION = step.to;
      try {
        await child.execute([step.path], false, context.repository, true);
      } catch (error) {
        throw new ApiError(
          "COMMAND_FAILED",
          `Migration v${step.from}-v${step.to} failed. Retry: ${quote(join(context.home, ".local/bin/luna"))} self update --install-dir ${quote(context.repository)}\n${String(error)}`,
        );
      }
      await saveVersion(context, step.to);
    }
  });
}
