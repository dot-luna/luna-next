import { join } from "pathe";
import { appCatalog } from "@/modules/apps/catalog.ts";
import { appContext } from "@/modules/apps/context.ts";
import { appInstaller } from "@/modules/apps/install.ts";
import { applyDefaults, readDefaults } from "@/modules/defaults/index.ts";
import type { InstallOptions } from "./context.ts";
import { cliBuilder } from "./install/build.ts";
import { selfCheckout } from "./install/checkout.ts";
import type { InstallContext } from "./install/command.ts";
import { gitConfigurator } from "./install/git.ts";
import { packageRecipes } from "./install/packages.ts";
import { installReport, type InstallResult } from "./install/report.ts";
import { bundledThemes } from "./install/themes.ts";
import { bundledWebapps } from "./install/webapps.ts";
import { migrationRunner } from "./migrations/run.ts";
import { migrationState } from "./migrations/state.ts";

class SelfInstaller {
  /**
   * Install under the self-operation lock: packages, CLI, migrations, Git, themes, apps,
   * later packages, web apps, then system defaults. Bootstrap skips the checkout update,
   * system upgrade and CLI publication. The installed version is saved only when every
   * step succeeds; completed steps remain on failure.
   */
  install({ context, options }: { context: InstallContext; options: InstallOptions }) {
    return migrationState.selfLocked({
      context,
      operation: async (): Promise<InstallResult> => {
        // Builds started from here must not run migrations; this installer runs them below.
        context.env.LUNA_SELF_INSTALL = "1";
        let stopSudo = async () => {};
        try {
          const { repository, home } = context;
          await this._readRecipes(context);
          if (!options.fromBootstrap) {
            context.progress("Updating Luna checkout...");
            await selfCheckout.update({ context, ref: options.ref ?? "latest" });
          }
          // Re-read recipes after pulling so setup uses the selected checkout's package lists.
          const packages = await this._readRecipes(context);
          await context.execute(["sudo", "-v"]);
          stopSudo = context.keepSudoAlive();
          if (!options.fromBootstrap)
            await context.execute(["sudo", "pacman", "-Syu", "--needed", "--noconfirm"]);
          context.progress("Installing before-CLI packages...");
          await packageRecipes.install({ context, recipes: packages.before_cli });
          const executable = join(home, ".local/bin/luna");
          if (!options.fromBootstrap) {
            context.progress("Building and installing Luna CLI...");
            await cliBuilder.build({ context, executable });
          }
          const previous = await migrationState.read(context);
          if (previous) await migrationRunner.run({ context, baseline: previous.version });
          context.progress("Configuring Git...");
          await gitConfigurator.configure({ context, options });
          context.progress("Installing after-CLI packages and mise tools...");
          await packageRecipes.install({
            context,
            recipes: [...packages.after_cli, ...packages.mise],
          });
          context.progress("Installing bundled themes...");
          await bundledThemes.install(context);
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
          await packageRecipes.install({ context: appsContext, recipes: packages.later });
          context.progress("Installing web apps...");
          const installedWebapps = await bundledWebapps.install({
            context: appsContext,
            skipFailed: options.skipFailed,
            failed,
          });
          context.progress("Applying application defaults...");
          await installReport.attempt({
            context: appsContext,
            app: "defaults",
            retry: `${installReport.quote(executable)} defaults reset --install-dir ${installReport.quote(repository)}`,
            skipFailed: options.skipFailed ?? false,
            failed,
            operation: () => applyDefaults(appsContext),
          });
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
          if (result.completed)
            await migrationState.save({
              context,
              version: await migrationState.checkoutVersion(repository),
            });
          context.log.finish(result);
          return result;
        } catch (error) {
          throw context.failure(error);
        } finally {
          await stopSudo();
        }
      },
    });
  }

  /** Validate every package, app, web app and defaults list before changing the system. */
  private async _readRecipes(context: InstallContext) {
    const packages = await packageRecipes.read({ context });
    await appCatalog.read(
      await appContext.resolve({
        repository: context.repository,
        env: context.env,
        log: context.log,
      }),
    );
    await bundledWebapps.read(context);
    await readDefaults(context);
    return packages;
  }
}

export const selfInstaller = new SelfInstaller();
