import { join } from "pathe";
import { respond } from "@/lib/response.ts";
import {
  checkoutVersion,
  readState,
  saveVersion,
  selfLocked,
} from "@/modules/self/migrations/state.ts";
import { runMigrations } from "@/modules/self/migrations/run.ts";
import { prepareContext } from "@/modules/self/context.ts";
import { buildCli } from "./build.ts";
import { updateCheckout } from "./checkout.ts";
import { configureGit } from "./git.ts";
import { installPackages, readPackages } from "./packages.ts";
import { appInstaller } from "@/modules/apps/install.ts";
import { appContext } from "@/modules/apps/context.ts";
import { appCatalog } from "@/modules/apps/catalog.ts";
import { installLaterPackages } from "./later.ts";
import { installWebApps, readWebapps } from "./webapps.ts";
import { installThemes } from "./themes.ts";
import { applyDefaults, readDefaults } from "@/modules/defaults/index.ts";
import { attempt, quote } from "./report.ts";
import type { InstallOptions, InstallResponse } from "./types.ts";

/**
 * Install a Luna checkout through apps, later packages, web apps, then system defaults.
 * Bootstrap skips checkout updates and CLI publication, but still reconciles prerequisites.
 * Completed steps remain on failure; completion is reported only after every stage succeeds.
 * Commands run as the caller; sudo handles packages and login-shell selection.
 */
export function install(options: InstallOptions = {}): Promise<InstallResponse> {
  return respond(async () => {
    const context = await prepareContext(options);
    return selfLocked(context, async () => {
      context.env.LUNA_SELF_INSTALL = "1";
      let stopSudo = async () => {};
      try {
        const { repository, home } = context;
        const ref = options.ref ?? "latest";
        await readPackages(context);
        await appCatalog.read(
          await appContext.resolve({ repository, env: context.env, log: context.log }),
        );
        await readWebapps(context);
        await readDefaults(context);
        if (!options.fromBootstrap) {
          context.progress("Updating Luna checkout...");
          await updateCheckout(context, ref);
        }
        // Re-read recipes after pulling so setup uses the selected checkout's package lists.
        const packages = await readPackages(context);
        await appCatalog.read(
          await appContext.resolve({ repository, env: context.env, log: context.log }),
        );
        await readWebapps(context);
        await readDefaults(context);
        await context.execute(["sudo", "-v"]);
        stopSudo = context.keepSudoAlive();
        if (!options.fromBootstrap)
          await context.execute(["sudo", "pacman", "-Syu", "--needed", "--noconfirm"]);
        context.progress("Installing before-CLI packages...");
        await installPackages(context, packages.before_cli);
        const executable = join(home, ".local/bin/luna");
        if (!options.fromBootstrap) {
          context.progress("Building and installing Luna CLI...");
          await buildCli(context, executable);
        }
        const previous = await readState(context);
        if (previous) await runMigrations(context, previous.version);
        context.progress("Configuring Git...");
        await configureGit(context, options);
        context.progress("Installing after-CLI packages and mise tools...");
        await installPackages(context, [...packages.after_cli, ...packages.mise]);
        context.progress("Installing bundled themes...");
        await installThemes(context);
        const appsContext = await appContext.resolve({
          repository,
          env: context.env,
          onProgress: context.onProgress,
          log: context.log,
        });
        context.progress("Installing and configuring apps...");
        const appResult = await appInstaller.install({
          context: appsContext,
          skipFailed: options.skipFailed,
          closeApps: options.closeApps !== false,
        });
        const failed = appResult.failed;
        context.progress("Installing later packages...");
        await installLaterPackages(appsContext, packages.later);
        context.progress("Installing web apps...");
        const installedWebapps = await installWebApps(appsContext, options.skipFailed, failed);
        context.progress("Applying application defaults...");
        await attempt(
          appsContext,
          "defaults",
          `${quote(executable)} defaults reset --install-dir ${quote(repository)}`,
          options.skipFailed ?? false,
          failed,
          () => applyDefaults(appsContext),
        );
        const result = {
          repository,
          executable,
          cliRebuilt: !options.fromBootstrap,
          completed: failed.length === 0,
          failed,
          logDirectory: context.log.directory,
          installedApps: appResult.installed,
          installedWebapps,
          pending: [] as [],
        };
        if (result.completed) await saveVersion(context, await checkoutVersion(repository));
        context.log.finish(result);
        return result;
      } catch (error) {
        throw context.failure(error);
      } finally {
        await stopSudo();
      }
    });
  });
}
