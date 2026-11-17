import { join } from "pathe";
import type { RepositoryOptions } from "../lib/repository.ts";
import { ApiError, respond, type ApiResponse } from "../lib/response.ts";
import { prepareContext } from "./context.ts";
import { buildCli } from "./install/build.ts";
import { updateCheckout } from "./install/checkout.ts";
import { migrationPlan } from "./migrations/plan.ts";
import { checkoutVersion, readState, saveVersion, selfLocked } from "./migrations/state.ts";

export interface UpdateOptions extends RepositoryOptions {
  /** Branch or tag; latest follows the remote default branch. */
  ref?: string;
  onProgress?: (message: string) => void;
}

export interface UpdateResult {
  repository: string;
  executable: string;
}

export type UpdateResponse = ApiResponse<UpdateResult>;

/**
 * Update the checkout, build the CLI, and apply the complete release migration chain.
 * Requires mise from installation. A failed build preserves the installed executable;
 * Completed migrations remain on failure; scripts must be safe to retry.
 * The fetched build runs migrations before publishing the new executable.
 */
export function update(options: UpdateOptions = {}): Promise<UpdateResponse> {
  return respond(async () => {
    const context = await prepareContext(options);
    if (!Bun.which("mise", { PATH: context.env.PATH }))
      throw new ApiError("INVALID_ENVIRONMENT", "mise is required; run self install first");
    return selfLocked(context, async () => {
      try {
        const baseline =
          (await readState(context))?.version ?? (await checkoutVersion(context.repository));
        // Save the installed baseline before Git moves; a failed build must not advance it.
        await saveVersion(context, baseline);
        context.env.LUNA_UPDATE_FROM_VERSION = baseline;
        context.progress("Updating Luna checkout...");
        await updateCheckout(context, options.ref ?? "latest");
        await migrationPlan({
          repository: context.repository,
          from: baseline,
          to: await checkoutVersion(context.repository),
        });
        const executable = join(context.home, ".local/bin/luna");
        context.progress("Building and installing Luna CLI...");
        await buildCli(context, executable);
        return { repository: context.repository, executable };
      } catch (error) {
        throw context.failure(error);
      }
    });
  });
}
