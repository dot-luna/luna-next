import { respond } from "@/lib/response.ts";
import { selfContext, type InstallOptions, type UpdateOptions } from "./context.ts";
import type { InstallResponse, UpdateResponse } from "./install/report.ts";
import { selfInstaller } from "./installer.ts";
import { selfUpdater } from "./updater.ts";

/** Install and update Luna's own checkout; each call resolves and validates a fresh context. */
class Self {
  /**
   * Install a Luna checkout through apps, later packages, web apps, then system defaults.
   * Bootstrap skips checkout updates and CLI publication, but still reconciles prerequisites.
   * Completed steps remain on failure; completion is reported only after every stage succeeds.
   * Commands run as the caller; sudo handles packages and login-shell selection.
   */
  install(options: InstallOptions = {}): Promise<InstallResponse> {
    return respond(async () =>
      selfInstaller.install({ context: await selfContext.resolve(options), options }),
    );
  }

  /**
   * Update the checkout, build the CLI, and apply the complete release migration chain.
   * Requires mise from installation. A failed build preserves the installed executable;
   * completed migrations remain on failure; scripts must be safe to retry.
   * The fetched build runs migrations before publishing the new executable.
   */
  update(options: UpdateOptions = {}): Promise<UpdateResponse> {
    return respond(async () =>
      selfUpdater.update({
        context: await selfContext.resolve(options),
        ref: options.ref ?? "latest",
      }),
    );
  }
}

export const self = new Self();
