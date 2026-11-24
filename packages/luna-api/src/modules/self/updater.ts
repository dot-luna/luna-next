import { join } from "pathe";
import { ApiError } from "@/lib/response.ts";
import type { InstallContext } from "./install/command.ts";
import { cliBuilder } from "./install/build.ts";
import { selfCheckout } from "./install/checkout.ts";
import { installReport, type UpdateResult } from "./install/report.ts";
import { migrationPlanner } from "./migrations/plan.ts";
import { migrationState } from "./migrations/state.ts";

class SelfUpdater {
  /**
   * Under the self-operation lock: save the installed version, move the checkout to ref,
   * require a complete migration chain to its version, then build and publish the CLI.
   * The fetched build runs the migrations before publication (see buildMigrations).
   * Failures carry retry guidance; completed migrations and the moved checkout remain.
   */
  async update({ context, ref }: { context: InstallContext; ref: string }): Promise<UpdateResult> {
    try {
      if (!Bun.which("mise", { PATH: context.env.PATH }))
        throw new ApiError("INVALID_ENVIRONMENT", "mise is required; run self install first");
      return await migrationState.selfLocked({
        context,
        operation: async () => {
          const baseline =
            (await migrationState.read(context))?.version ??
            (await migrationState.checkoutVersion(context.repository));
          // Save the installed baseline before Git moves; a failed build must not advance it.
          await migrationState.save({ context, version: baseline });
          context.env.LUNA_UPDATE_FROM_VERSION = baseline;
          context.progress("Updating Luna checkout...");
          await selfCheckout.update({ context, ref });
          await migrationPlanner.plan({
            repository: context.repository,
            from: baseline,
            to: await migrationState.checkoutVersion(context.repository),
          });
          const executable = join(context.home, ".local/bin/luna");
          context.progress("Building and installing Luna CLI...");
          await cliBuilder.build({ context, executable });
          return { repository: context.repository, executable };
        },
      });
    } catch (error) {
      const failure = error instanceof ApiError ? error : new ApiError("IO_ERROR", String(error));
      const retry = `${installReport.quote(join(context.home, ".local/bin/luna"))} self update --install-dir ${installReport.quote(context.repository)} --ref ${installReport.quote(ref)}`;
      throw context.failure(
        new ApiError(
          failure.code,
          `Luna update incomplete. Fix the error below, then retry:\n${retry}\n` +
            `Completed migration steps are saved; retry resumes the remaining steps.\n` +
            `The checkout may already be updated. Reverting Git does not undo applied migrations.\n\n${failure.message}`,
        ),
      );
    }
  }
}

export const selfUpdater = new SelfUpdater();
