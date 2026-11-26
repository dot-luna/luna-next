import { dirname, join } from "pathe";
import { locked, metadata } from "@/lib/files.ts";
import { ordinaryParents } from "@/lib/paths.ts";
import { ApiError } from "@/lib/response.ts";
import { InstallContext } from "@/modules/self/install/command.ts";
import { installReport } from "@/modules/self/install/report.ts";
import { migrationPlanner } from "./plan.ts";
import { migrationState } from "./state.ts";

class MigrationRunner {
  /**
   * Run trusted release scripts as the caller from the recorded version, or baseline when
   * none is recorded, to the checkout version. The version is saved after each script, so a
   * retry resumes at the failed step; scripts must tolerate partial execution on retry.
   */
  async run({ context, baseline }: { context: InstallContext; baseline: string }) {
    const path = migrationState.path(context);
    await ordinaryParents(path);
    const lock = await metadata(path + ".lock");
    if (lock && !lock.isFile()) throw new ApiError("INVALID_PATH", "Invalid migration lock");
    await locked({ configFile: path, env: context.env }, async () => {
      const current = (await migrationState.read(context))?.version ?? baseline;
      const target = await migrationState.checkoutVersion(context.repository);
      const plan = await migrationPlanner.plan({
        repository: context.repository,
        from: current,
        to: target,
      });
      await migrationState.save({ context, version: current });
      const env = { ...context.env };
      // A migration may rebuild the CLI. That nested build must not start migrations again.
      delete env.LUNA_UPDATE_FROM_VERSION;
      env.LUNA_MIGRATION_RUNNING = "1";
      env.PATH = `${join(context.repository, "target")}:${dirname(process.execPath)}:${env.PATH ?? ""}`;
      env.LUNA_ROOT = context.repository;
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
            `Migration v${step.from}-v${step.to} failed. Retry: ${installReport.quote(join(context.home, ".local/bin/luna"))} self update --install-dir ${installReport.quote(context.repository)}\n${String(error)}`,
          );
        }
        await migrationState.save({ context, version: step.to });
      }
    });
  }
}

export const migrationRunner = new MigrationRunner();
