import { join } from "pathe";
import { respond } from "@/lib/response.ts";
import { locked } from "@/lib/files.ts";
import { appCatalog } from "./catalog.ts";
import { appContext, type AppOptions, type AppUninstallOptions } from "./context.ts";
import { appConfigurator } from "./configure.ts";
import { appUninstaller } from "./uninstall.ts";
import { appInstaller } from "./install.ts";
import { appProcesses } from "./processes.ts";
import { appState } from "./state.ts";

/** Public app operations resolve a fresh context and report failures through Luna's API response. */
class Apps {
  /**
   * Install and configure selected apps in catalog order; omitted names select all apps.
   * Apps with enabled: false are skipped in both named and bulk installations.
   * Successful steps remain on failure. skipFailed records app failures and continues.
   */
  install(names: string[] = [], options: AppOptions = {}) {
    return respond(async () => {
      const context = await appContext.resolve(options);
      try {
        return await appInstaller.install({
          context,
          names,
          force: options.force,
          skipFailed: options.skipFailed,
          closeApps: options.closeApps !== false,
        });
      } catch (error) {
        throw context.failure(error);
      }
    });
  }

  /**
   * Configure selected apps without installing packages, under each app's lifecycle lock.
   * Close declared processes unless disabled; stop at the first failure and retain completed writes.
   */
  configure(names: string[] = [], options: AppOptions = {}) {
    return respond(async () => {
      const context = await appContext.resolve(options);
      try {
        const selected = appCatalog.select({ apps: await appCatalog.read(context), names });
        for (const app of selected) {
          const file = join(context.env.LUNA_STATE_HOME_DIR!, "apps", `${app.id}.jsonc`);
          await locked({ configFile: file, env: context.env }, async () => {
            if (options.closeApps !== false) await appProcesses.close({ context, app });
            await appConfigurator.configure({ context, app });
          });
        }
        const configured = selected.map((app) => app.id);
        context.log.finish({ completed: true, configured, logDirectory: context.log.directory });
        return configured;
      } catch (error) {
        throw context.failure(error);
      }
    });
  }
  /**
   * Return the IDs of installed catalog apps in catalog order; omitted names select all apps.
   * Read-only, so migrations can refresh only apps a system actually has.
   */
  installed(names: string[] = [], options: AppOptions = {}) {
    return respond(async () => {
      const context = await appContext.resolve(options);
      try {
        const installed: string[] = [];
        for (const app of appCatalog.select({ apps: await appCatalog.read(context), names }))
          if (await appState.installed({ context, app })) installed.push(app.id);
        context.log.finish({ completed: true, installed, logDirectory: context.log.directory });
        return installed;
      } catch (error) {
        throw context.failure(error);
      }
    });
  }

  /** Update installed catalog apps; omitted names select all installed apps. */
  update(names: string[] = [], options: AppOptions = {}) {
    return respond(async () => {
      const context = await appContext.resolve(options);
      try {
        return await appInstaller.update({
          context,
          names,
          force: options.force,
          skipFailed: options.skipFailed,
          closeApps: options.closeApps !== false,
        });
      } catch (error) {
        throw context.failure(error);
      }
    });
  }

  /** Remove named apps; purge also removes declared settings/data and works after an earlier uninstall. */
  uninstall(names: string[], options: AppUninstallOptions = {}) {
    return respond(async () => {
      const context = await appContext.resolve(options);
      try {
        return await appUninstaller.uninstall({
          context,
          names,
          purge: options.purge,
          skipFailed: options.skipFailed,
          closeApps: options.closeApps !== false,
        });
      } catch (error) {
        throw context.failure(error);
      }
    });
  }
}

export const apps = new Apps();
