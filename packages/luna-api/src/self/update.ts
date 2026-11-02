import { join } from "pathe";
import type { RepositoryOptions } from "../lib/repository.ts";
import { ApiError, respond, type ApiResponse } from "../lib/response.ts";
import { prepareContext } from "./context.ts";
import { buildCli } from "./install/build.ts";
import { updateCheckout } from "./install/checkout.ts";

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
 * Safely update the selected checkout and rebuild/publish only the CLI.
 * Requires mise from installation. A failed build preserves the installed executable;
 * completed checkout updates remain. Git configuration and desktop setup do not run.
 */
export function update(options: UpdateOptions = {}): Promise<UpdateResponse> {
  return respond(async () => {
    const context = await prepareContext(options);
    if (!Bun.which("mise", { PATH: context.env.PATH }))
      throw new ApiError("INVALID_ENVIRONMENT", "mise is required; run self install first");
    context.progress("Updating Luna checkout...");
    await updateCheckout(context, options.ref ?? "latest");
    const executable = join(context.home, ".local/bin/luna");
    context.progress("Building and installing Luna CLI...");
    await buildCli(context, executable);
    return { repository: context.repository, executable };
  });
}
