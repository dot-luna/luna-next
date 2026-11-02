import { join } from "pathe";
import { respond } from "../../lib/response.ts";
import { prepareContext } from "../context.ts";
import { buildCli } from "./build.ts";
import { updateCheckout } from "./checkout.ts";
import { configureGit } from "./git.ts";
import { installPackages, readPackages } from "./packages.ts";
import { installApps } from "../../apps/index.ts";
import { appContext } from "../../apps/context.ts";
import { readCatalog } from "../../apps/catalog.ts";
import { installLaterPackages } from "./later.ts";
import { installWebApps, readWebapps } from "./webapps.ts";
import { installThemes } from "./themes.ts";
import type { InstallOptions, InstallResponse } from "./types.ts";

/**
 * Install an existing Arch Linux Luna checkout through apps, later packages and web apps.
 * Bootstrap skips checkout updates and CLI publication, but still reconciles prerequisites.
 * Completed steps remain on failure; completion is reported only after every stage succeeds.
 * Commands run as the caller, using sudo only for system packages; the API never prompts.
 */
export function install(options: InstallOptions = {}): Promise<InstallResponse> {
  return respond(async () => {
    const context = await prepareContext(options);
    const { repository, home } = context;
    const ref = options.ref ?? "latest";
    await readPackages(context);
    await readCatalog(await appContext({ repository, env: context.env }));
    await readWebapps(context);
    if (!options.fromBootstrap) {
      context.progress("Updating Luna checkout...");
      await updateCheckout(context, ref);
    }
    // Re-read recipes after pulling so setup uses the selected checkout's package lists.
    const packages = await readPackages(context);
    await readCatalog(await appContext({ repository, env: context.env }));
    await readWebapps(context);
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
    context.progress("Installing bundled themes...");
    await installThemes(context);
    const appsContext = await appContext({
      repository,
      env: context.env,
      onProgress: context.progress,
    });
    context.progress("Installing and configuring apps...");
    const installedApps = await installApps(appsContext);
    context.progress("Installing later packages...");
    await installLaterPackages(appsContext, packages.later);
    context.progress("Installing web apps...");
    const installedWebapps = await installWebApps(appsContext);
    return {
      repository,
      executable,
      cliRebuilt: !options.fromBootstrap,
      completed: true,
      installedApps,
      installedWebapps,
      pending: [],
    };
  });
}
