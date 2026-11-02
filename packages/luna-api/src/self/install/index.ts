import { join } from "pathe";
import { respond } from "../../lib/response.ts";
import { prepareContext } from "../context.ts";
import { buildCli } from "./build.ts";
import { updateCheckout } from "./checkout.ts";
import { configureGit } from "./git.ts";
import { installPackages, readPackages } from "./packages.ts";
import { installApps, installLaterPackages, installThemes, installWebApps } from "./pending.ts";
import type { InstallOptions, InstallResponse } from "./types.ts";

/**
 * Prepare an existing Arch Linux Luna checkout through after_cli packages and mise tools.
 * Bootstrap skips checkout updates and CLI publication, but still reconciles prerequisites.
 * Completed steps remain on failure. Themes, apps, later packages, and web apps are pending.
 * Commands run as the caller, using sudo only for system packages; the API never prompts.
 */
export function install(options: InstallOptions = {}): Promise<InstallResponse> {
  return respond(async () => {
    const context = await prepareContext(options);
    const { repository, home } = context;
    const ref = options.ref ?? "latest";
    await readPackages(context);
    if (!options.fromBootstrap) {
      context.progress("Updating Luna checkout...");
      await updateCheckout(context, ref);
    }
    // Re-read recipes after pulling so setup uses the selected checkout's package lists.
    const packages = await readPackages(context);
    await context.execute(["sudo", "-v"]);
    if (!options.fromBootstrap)
      await context.execute(["sudo", "pacman", "-Syu", "--needed", "--noconfirm"]);
    context.progress("Installing before-CLI packages...");
    await installPackages(context, packages.before_cli);
    const executable = join(home, ".local/bin/luna");
    if (!options.fromBootstrap) {
      context.progress("Building and installing Luna CLI...");
      await buildCli(context, executable);
    }
    context.progress("Configuring Git...");
    await configureGit(context, options);
    context.progress("Installing after-CLI packages and mise tools...");
    await installPackages(context, [...packages.after_cli, ...packages.mise]);
    installThemes();
    installApps();
    installLaterPackages();
    installWebApps();
    return {
      repository,
      executable,
      cliRebuilt: !options.fromBootstrap,
      pending: ["themes", "apps", "later", "webapps"],
    };
  });
}
